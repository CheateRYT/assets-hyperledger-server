const express = require("express");
const fs = require("fs");
const grpc = require("@grpc/grpc-js");
const { connect, signers } = require("@hyperledger/fabric-gateway");
const crypto = require("crypto");
const hash = require("crypto").createHash;
const utf8Decoder = new TextDecoder("utf-8");
const cors = require("cors");
const app = express();
const port = 3000;
const peerEndpoint = "localhost:7051";
const peerHostOverride = "peer0.org1.example.com"; // Изменить на другой хост для другой организации при передаче

// Укажите пути к сертификатам и ключам
const tlsCertPath =
  "/home/user/project/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/tlsca/tlsca.org1.example.com-cert.pem";
const certPath =
  "/home/user/project/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts/Admin@org1.example.com-cert.pem";
const keyPath =
  "/home/user/project/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/keystore/priv_sk"; // Убедитесь, что это правильный путь к вашему приватному ключу

async function newGrpcConnection() {
  const tlsRootCert = await fs.promises.readFile(tlsCertPath);
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(peerEndpoint, tlsCredentials, {
    "grpc.ssl_target_name_override": peerHostOverride,
  });
}

async function main() {
  const client = await newGrpcConnection();
  const gateway = connect({
    client,
    identity: await newIdentity(),
    signer: await newSigner(),
    hash: hash.sha256,
  });
  const network = gateway.getNetwork("mychannel");
  const contract = network.getContract("basic");

  // Middleware для парсинга JSON
  app.use(express.json());
  app.use(
    cors({
      origin: "http://localhost:5173", // Разрешает доступ только с этого источника
    })
  );
  // Простой маршрут
  app.get("/", async (req, res) => {
    res.send(await contract.submitTransaction("InitLedger"));
  });

  // Маршрут для создания активов
  app.post("/api/assets", async (req, res) => {
    const assetId = `asset${String(Date.now())}`;
    const { color, size, owner, value } = req.body;
    try {
      await contract.submitTransaction(
        "CreateAsset",
        assetId,
        color,
        size,
        owner,
        value
      );
      res.status(201).json({ message: "Актив успешно создан!", assetId });
    } catch (error) {
      console.error("Ошибка при создании актива:", error);
      res.status(500).json({ error: "Ошибка при создании актива" });
    }
  });

  // Маршрут для передачи активов
  app.post("/api/assets/transfer", async (req, res) => {
    const { assetId, newOwner } = req.body;
    try {
      const commit = await contract.submitAsync("TransferAsset", {
        arguments: [assetId, newOwner],
      });
      const oldOwner = utf8Decoder.decode(commit.getResult());
      console.log(`*** Успешно передан актив от ${oldOwner} к ${newOwner}`);
      console.log("*** Ожидание подтверждения транзакции");
      const status = await commit.getStatus();
      if (!status.successful) {
        throw new Error(
          `Транзакция ${
            status.transactionId
          } не была подтверждена с кодом статуса ${String(status.code)}`
        );
      }
      console.log("*** Транзакция успешно подтверждена");
      res.json({
        message: "Транзакция успешно подтверждена",
        oldOwner,
        newOwner,
      });
    } catch (error) {
      console.error("Ошибка при передаче актива:", error);
      res.status(500).json({ error: "Ошибка при передаче актива" });
    }
  });
  app.get("/api/data", async (req, res) => {
    try {
      const resultBytes = await contract.evaluateTransaction("GetAllAssets");
      const resultJson = utf8Decoder.decode(resultBytes);
      const result = JSON.parse(resultJson);
      console.log("*** Result:", result);
      res.json(result);
    } catch (error) {
      console.error("Ошибка при получении данных:", error);
      res.status(500).json({ error: "Ошибка при получении данных" });
    }
  });

  // Маршрут для чтения активов
  app.get("/api/assets/:assetId", async (req, res) => {
    const assetId = req.params.assetId;
    try {
      const resultBytes = await contract.evaluateTransaction(
        "ReadAsset",
        assetId
      );
      const resultJson = utf8Decoder.decode(resultBytes);
      const result = JSON.parse(resultJson);
      console.log("*** Результат:", result);
      res.json(result);
    } catch (error) {
      console.error("Ошибка при чтении актива:", error);
      res.status(500).json({ error: "Ошибка при чтении актива" });
    }
  });

  // Маршрут для обновления активов
  app.post("/api/assets/update", async (req, res) => {
    const { assetId, color, size, owner, value } = req.body;
    try {
      await contract.submitTransaction(
        "UpdateAsset",
        assetId,
        color,
        size,
        owner,
        value
      );
      console.log(`*** Актив ${assetId} успешно обновлен`);
      res.json({ message: `Актив ${assetId} успешно обновлен` });
    } catch (error) {
      console.log("*** Успешно поймано исключение: \n", error);
      res.status(500).json({ error: "Ошибка при обновлении актива" });
    }
  });

  // Запуск сервера
  app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
  });
}

async function newIdentity() {
  const credentials = await fs.promises.readFile(certPath);
  return { mspId: "Org1MSP", credentials };
}

async function newSigner() {
  const privateKeyPem = await fs.promises.readFile(keyPath);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

// Запуск основного процесса
main().catch(console.error);
