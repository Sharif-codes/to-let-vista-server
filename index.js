const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const stripe = require("stripe")(process.env.PAYMENT_SK);
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAIL_GUN_API_KEY,
})
const port = process.env.PORT || 5000

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@to-let.ahzbrw1.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const usersCollection = client.db('toLetDB').collection('users')
    const propertyCollection = client.db('toLetDB').collection('properties')
    const bookingRequestCollection = client.db('toLetDB').collection('bookingRequests')
    const bookingCollection = client.db('toLetDB').collection('bookings')
    const toLetRequestCoolection = client.db('toLetDB').collection('ToletRequests')
    const paymentCollection = client.db('toLetDB').collection('payments')
    const ownerShipReqCollection = client.db('toLetDB').collection('ownership')

    app.post('/jwt', async (req, res) => {
      const user = req.body
      // console.log(process.env.ACCESS_TOKEN)
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d'
      })
      console.log(token);
      res.send({ token })
    })
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token:',req.headers )
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'not authorized access' })
      }
      const token = req.headers.authorization.split(' ')[1]
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        // console.log(error);
        if (error) {
          return res.status(401).send({ message: 'unauthorized access' })
        }
        req.decoded = decoded
        console.log("token user: ", decoded);
        next()
      })
    }
    const verifyOwner = async (req, res, next) => {
      const email = req.decoded.email
      const query = { email: email }
      const user = await userCollection.findOne(query)
      const isOwner = user?.role === 'owner'
      if (!isOwner) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // Save or modify user email, status in DB
    app.put('/users/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body
      const query = { email: email }
      const options = { upsert: true }
      const isExist = await usersCollection.findOne(query)
      console.log('User found?----->', isExist)
      if (isExist) return res.send(isExist)
      const result = await usersCollection.updateOne(
        query,
        {
          $set: { ...user, timestamp: Date.now() },
        },
        options
      )
      res.send(result)
    })

    //find admin
    app.get('/user/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      let admin = false
      if (user) {
        admin = user?.role === 'admin'
      }
      res.send({ admin })
    })
    //find Owner
    app.get('/user/owner/:email', verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      let owner = false
      if (user) {
        owner = user?.role === 'owner'
      }
      res.send({ owner })
    })
    //find member
    app.get('/user/member/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      console.log(email);
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      let member = false
      if (user) {
        member = user?.role === 'member'
      }
      console.log("check result", member);
      res.send({ member })
    })
    //Tolet request by owner
    app.post('/ToLetRequest', async (req, res) => {
      const data = req.body
      const result = await toLetRequestCoolection.insertOne(data)
      res.send(result)
    })
    //To-let Request get by admin
    app.get('/ToLetRequest', async (req, res) => {
      const result = await toLetRequestCoolection.find().toArray()
      res.send(result)
    })

    //To-let Request accept by admin
    app.post('/acceptToLetRequest/:id', async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const updatedStatus = {
        $set: {
          status: "available"
        }
      }
      await toLetRequestCoolection.updateOne(filter, updatedStatus)
      const property = await toLetRequestCoolection.findOne(filter)
      const result = await propertyCollection.insertOne(property)
      await toLetRequestCoolection.deleteOne(property)
      res.send(result)
    })
    //To-Let Request reject by admin
    app.post('/rejectToLetRequest/:id', async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const property = await toLetRequestCoolection.findOne(filter)
      const result = await toLetRequestCoolection.deleteOne(property)
      res.send(result)
    })
    //get all properties homepage
    app.get('/property', async (req, res) => {
      // const category = req.params.category
      const query = { status: "available" }
      const result = await propertyCollection.find(query).toArray()
      res.send(result)
    })
    //get all property for admin
    app.get('/allProperty', async (req, res) => {
      const result = await propertyCollection.find().toArray()
      res.send(result)
    })

    // get single property
    app.get('/Singleproperty/:id', async (req, res) => {
      const id = req.params.id
      const result = await propertyCollection.findOne({ _id: new ObjectId(id) })
      res.send(result)
    })
    //get owner myProperty
    app.get('/myProperties/:email', async (req, res) => {
      const email = req.params.email
      console.log("property email", email);
      const query = { host_email: email }
      const result = await propertyCollection.find(query).toArray()
      res.send(result)
    })
    //book request
    app.post('/bookingRequest', async (req, res) => {
      const data = req.body
      const result = await bookingRequestCollection.insertOne(data)
      res.send(result)
    })
    //get member booking request
    app.get('/myBookings/:email', async (req, res) => {
      const email = req.params.email
      const query = { claimer: email }
      const result = await bookingCollection.find(query).toArray()
      res.send(result)
    })

    //get admin all booking request
    app.get("/AllbookingRequest", async (req, res) => {
      const result = await bookingRequestCollection.find().toArray()
      res.send(result)
    })

    //get owner request
    app.get('/bookingRequest/:email', async (req, res) => {
      const email = req.params.email
      const query = { host_email: email, status: "requested" }
      const result = await bookingCollection.find(query).toArray()
      res.send(result)
    })

    //accept booking request
    app.patch('/acceptRequest/:id', async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const document = {
        $set: {
          status: "accepted"
        }
      }
      const result = await bookingCollection.updateOne(filter, document)
      res.send(result)
    })
    //Accept booking Request
    app.post("/booking/accept/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const updateStatus = {
        $set: {
          status: "accepted"
        }
      }
      await bookingRequestCollection.updateOne(query, updateStatus)
      const addBookingData = await bookingRequestCollection.findOne(query)
      const result = await bookingCollection.insertOne(addBookingData)
      await bookingRequestCollection.deleteOne(query)
      res.send(result)
    })
    //Reject Booking Request
    app.post("/booking/reject/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await bookingRequestCollection.deleteOne(query)
      res.send(result)
    })
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const price = req.body.price
      const amount = price * 100
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"]
      });
      console.log(paymentIntent.client_secret);
      res.send({
        ClientSecret: paymentIntent.client_secret
      })
    })
    app.post("/payment", verifyToken, async (req, res) => {
      const paymentData = req.body
      const bookingID = req.body.bookingID
      const proprtyID = req.body.propertyID
      const statusChanged = {
        $set: {
          status: "booked"
        }
      }
      await bookingCollection.updateOne({ _id: new ObjectId(bookingID) }, statusChanged)
      await propertyCollection.updateOne({ _id: new ObjectId(proprtyID) }, statusChanged)
      const result = await paymentCollection.insertOne(paymentData)

      mg.messages
        .create(process.env.MAIL_SENDING_DOMAIN, {
          from: "Mailgun Sandbox <postmaster@sandbox80ec28c84b714ceaa186bb3baa7d53ac.mailgun.org>",
          to: ["sharifxenjia@gmail.com"],
          subject: "Confirmation of Payment",
          text: `Your Property is booked successfully! Transaction Id:  ${paymentData.TransactionId}`,
        })

      res.send(result)
    })
    app.get("/Allbookings", async (req, res) => {
      const result = await bookingRequestCollection.find().toArray()
      console.log(result);
      res.send(result)
    })
    app.get("/memberPayment/:email", async (req, res) => {
      const email = req.params.email
      console.log("member email: ", email);
      const query = { email: email }
      const result = await paymentCollection.find(query).toArray()
      res.send(result)
    })
    app.get("/allAcceptedBookings", async (req, res) => {
      const result = await bookingCollection.find().toArray()
      res.send(result)
    })

    //Ownership request added
    app.post("/ownershipRequest", async (req, res) => {
      try {
        const data = req.body;
        // console.log(data);
        // Wrap the email in an object with a field like 'email'
        // const requestData = { data };

        // Insert the wrapped data into the collection
        const result = await ownerShipReqCollection.insertOne(data);

        // Send the result back as a response
        res.send(result);
      } catch (error) {
        console.error("Error in ownership request:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    app.get("/ownershipRequest", async (req, res) => {
      const result = await ownerShipReqCollection.find().toArray()
      res.send(result)
    })
    app.patch("/acceptOwnershipReq/:email", async (req, res) => {
      const email = req.params.email
      const query = { email: email }
      const userReq = await ownerShipReqCollection.findOne(query)
      const userFind = await usersCollection.findOne(query)
      console.log("user Details", userFind);
      const updatedDoc = {
        $set: {
          role: "owner"
        }
      }
      const result = await usersCollection.updateOne(query, updatedDoc)
      await ownerShipReqCollection.deleteOne(userReq)
      res.send(result)
    })
    app.delete("/acceptOwnershipReq/:email", async (req, res) => {
      const email = req.params.email
      const query = { email: email }
      const user = await ownerShipReqCollection.findOne(query)
      const result = await ownerShipReqCollection.deleteOne(user)
      res.send(result)
    })
    app.get("/getUser", async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })
    app.delete("/deleteUser/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const user = await usersCollection.findOne(query)
      const result = await usersCollection.deleteOne(user)
      res.send(result)
    })
    app.delete("/deleteProperty/:id", async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const user = await propertyCollection.findOne(query)
      const result = await propertyCollection.deleteOne(user)
      res.send(result)
    })
    app.patch("/updateProperty/:id", async (req, res) => {
      const id = req.params.id
      const data = req.body
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          title: data.title,

          category: data.category,
          type: data.type,
          city: data.city,
          location: data.location,
          house: data.house,
          floor: data.floor,
          bedrooms: data.bedrooms,
          bathrooms: data.bathrooms,
          balcony: data.balcony,
          rent: data.rent,
          advance: data.advance,
          service: data.service,
          image1: data.image1,
          image2: data.image2,
          image3: data.image3,
          host_name: data.host_name,
          host_pic: data.host_pic,
          date: data.data,
          host_email: data.host_email,
          status: data.status,
          propertyDetails: data.propertyDetails
        }
      }
      const result = await propertyCollection.updateOne(filter, updatedDoc)
      res.send(result)

    })
    app.get("/getBooking/:id", async(req,res)=>{
      const id= req.params.id
      const query={bookingID: id}
      const result= await paymentCollection.findOne(query)
     res.send(result)
    })
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..')
})

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`)
})
