require("dotenv").config(); 
const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: "rzp_test_eXyUgxz2VtmepU",
  key_secret: "IOULEZFaWRNrL92MNqF5eDr0",
});

module.exports = razorpay;
