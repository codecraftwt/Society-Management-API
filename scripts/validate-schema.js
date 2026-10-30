// Schema validation script
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function validateSchema() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log("Validating schema against models...");
    
    // Get all tables in DB
    const [tables] = await conn.query("SHOW TABLES");
    const dbTables = new Set(tables.map(t => Object.values(t)[0]));
    
    // Get model table names
    const modelsDir = path.join(__dirname, '../models');
    const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js') && f !== 'index.js');
    
    console.log(`\nDB has ${dbTables.size} tables, ${modelFiles.length} model files`);
    
    // Basic validation
    for (const file of modelFiles) {
      const modelPath = path.join(modelsDir, file);
      delete require.cache[require.resolve(modelPath)];
      const Model = require(modelPath);
      if (Model.tableName) {
        if (!dbTables.has(Model.tableName)) {
          console.log(`⚠️ Table ${Model.tableName} for model ${file} not found in DB`);
        } else {
          console.log(`✅ Table ${Model.tableName} exists`);
        }
      }
    }
    
    console.log("\nValidation complete");
  } catch (err) {
    console.error("Validation error:", err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  validateSchema();
}

module.exports = { validateSchema };
