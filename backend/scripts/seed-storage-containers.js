require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const logger = require("../src/utils/logger");

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || "bioavanced";

if (!MONGO_URI) {
  logger.error("❌ MONGO_URI não definido no .env");
  process.exit(1);
}

async function seedStorageContainers() {
  let client;
  try {
    logger.info("🔗 Conectando ao MongoDB Atlas...");
    client = new MongoClient(MONGO_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    await client.connect();
    logger.info("✅ Conectado ao MongoDB Atlas!");

    const db = client.db(DB_NAME);

    // ===== 1. CRIAR FREEZER =====
    const freezersCollection = db.collection("storageContainers");
    const existingFreezers = await freezersCollection.countDocuments({
      containerType: "FREEZER",
    });

    if (existingFreezers > 0) {
      logger.info("ℹ️  Freezers já existem. Pulando seed.");
      return;
    }

    logger.info("📦 Iniciando seed de containers de armazenagem...");

    // Criar Freezer
    const freezerResult = await freezersCollection.insertOne({
      containerID: 1,
      name: "Ultra-Freezer 01",
      description: "Congelador ultra-low a -80°C",
      containerType: "FREEZER",
      parent_id: null,
      temperature: -80,
      temperatureUnit: "CELSIUS",
      capacity: 8,
      status: "OPERATIONAL",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const freezerId = freezerResult.insertedId;
    logger.info(`✅ Freezer criado: ${freezerId}`);

    // ===== 2. CRIAR SHELVES =====
    const shelves = [];
    for (let i = 1; i <= 2; i++) {
      const shelfResult = await freezersCollection.insertOne({
        name: `Prateleira ${i}`,
        description: `Prateleira ${i} do Freezer 01`,
        containerType: "SHELF",
        parent_id: freezerId,
        capacity: 4,
        status: "OPERATIONAL",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      shelves.push(shelfResult.insertedId);
      logger.info(`✅ Shelf criada: ${shelfResult.insertedId}`);
    }

    // ===== 3. CRIAR RACKS =====
    const racks = [];
    for (let shelfIdx = 0; shelfIdx < shelves.length; shelfIdx++) {
      for (let i = 1; i <= 3; i++) {
        const rackResult = await freezersCollection.insertOne({
          name: `Rack ${String.fromCharCode(64 + i)}`,
          description: `Rack ${String.fromCharCode(64 + i)} em Prateleira ${shelfIdx + 1}`,
          containerType: "RACK",
          parent_id: shelves[shelfIdx],
          capacity: 2,
          status: "OPERATIONAL",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        racks.push({ id: rackResult.insertedId, shelfId: shelves[shelfIdx] });
        logger.info(`✅ Rack criado: ${rackResult.insertedId}`);
      }
    }

    // ===== 4. CRIAR BOXES =====
    const boxesCollection = db.collection("storageBoxes");
    const pathsCollection = db.collection("storagePaths");

    let boxCount = 0;
    for (const rack of racks) {
      for (let i = 1; i <= 2; i++) {
        boxCount++;

        // Criar grid de posições (9x9)
        const occupancyGrid = new Map();
        for (let row = 0; row < 9; row++) {
          for (let col = 1; col <= 9; col++) {
            const position = `${String.fromCharCode(65 + row)}${col}`;
            occupancyGrid.set(position, null); // null = vazio
          }
        }

        const boxResult = await boxesCollection.insertOne({
          boxID: boxCount,
          name: `Box ${boxCount}`,
          description: `Caixa de armazenagem 9x9 - ${boxCount}`,
          parent_id: rack.id,
          dimension: { rows: 9, cols: 9 },
          occupancyGrid: Object.fromEntries(occupancyGrid),
          capacity: 81,
          currentOccupancy: 0,
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastModified: new Date(),
        });

        logger.info(`✅ Box criada: ${boxResult.insertedId}`);

        // ===== 5. CRIAR STORAGE PATH (Índice Hierárquico) =====
        await pathsCollection.insertOne({
          boxId: boxResult.insertedId,
          rackId: rack.id,
          shelfId: rack.shelfId,
          freezerId: freezerId,
          path: `Ultra-Freezer 01/Prateleira ${Math.floor((racks.indexOf(rack) / 3) + 1)}/Rack ${String.fromCharCode(65 + (racks.indexOf(rack) % 3))}/Box ${boxCount}`,
          createdAt: new Date(),
        });

        logger.info(`✅ StoragePath criado`);
      }
    }

    logger.info("✅ ===== SEED COMPLETO =====");
    logger.info(`   - 1 Freezer`);
    logger.info(`   - ${shelves.length} Shelves`);
    logger.info(`   - ${racks.length} Racks`);
    logger.info(`   - ${boxCount} Boxes (9x9 cada)`);
    logger.info(`   - ${boxCount} StoragePaths`);

  } catch (error) {
    logger.error("❌ Erro durante seed de containers:", error.message);
    if (error.name === "MongoServerSelectionError") {
      logger.error("💡 Verifique: MONGO_URI está correto? MongoDB Atlas está acessível?");
    }
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      logger.info("🔌 Conexão MongoDB fechada");
    }
  }
}

seedStorageContainers();
