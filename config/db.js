
const {Sequelize} = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host : process.env.DB_HOST,
        port : process.env.DB_PORT || 3306,
        dialect : 'mysql',
        logging: false
    }
);

module.exports = sequelize;


// const { Sequelize } = require("sequelize");
// require("dotenv").config();

// const sequelize = new Sequelize(process.env.DATABASE_URL, {
//   dialect: "mysql",
//   logging: false,
//   dialectOptions: {
//     connectTimeout: 60000
//   },
//   pool: {
//     max: 10,
//     min: 2,
//     acquire: 30000,
//     idle: 10000
//   }
// });

// module.exports = sequelize;                                                                                                          