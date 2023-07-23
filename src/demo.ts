import {
    Field,
    state,
    State,
    method,
    PrivateKey,
    SmartContract,
    Mina,
    AccountUpdate,
    isReady,
    shutdown,
    DeployArgs,
    fetchAccount,
    Nullifier,
    MerkleWitness,
    MerkleTree,
    PublicKey,
    UInt32,
    Poseidon
} from 'snarkyjs';
import fs from 'fs/promises';
import { isReadable } from 'stream';
import { MinaMix } from './MinaMix.js';

let { 
    depositorPrivateKey, 
    depositorAddress, 
    recipientPrivateKey, 
    recipientAddress, 
    url, 
    zkAppAddress, 
    nullifierMessage,
    startBlock 
}: any = JSON.parse(await fs.readFile('keys/demo.json', 'utf8'));

const DENOMINATION = BigInt(1 * 1e9);
const TREE_HEIGHT = 20;

class MinaMixMerkleWitness extends MerkleWitness(TREE_HEIGHT) {};

let Berkeley = Mina.Network('https://proxy.berkeley.minaexplorer.com/graphql');
Mina.setActiveInstance(Berkeley);

// Setting up the depositor account
let depositorResponse = await fetchAccount({ publicKey: depositorAddress });
if (depositorResponse.error) throw Error(depositorResponse.error.statusText);
let { nonce: depositorNonce, balance: depositorBalance } = depositorResponse.account;
console.log(`Using depositor account at ${depositorAddress} with nonce ${depositorNonce}, balance ${depositorBalance}`);

// Setting up the recipient account
let recipientResponse = await fetchAccount({ publicKey: recipientAddress });
if (recipientResponse.error) throw Error(recipientResponse.error.statusText);
let { nonce: recipientNonce, balance: recipientBalance } = recipientResponse.account;
console.log(`Using fee payer account at ${recipientAddress} with nonce ${recipientNonce}, balance ${recipientBalance}`);

// Connecting to testnet
const Network = Mina.Network(url);
const fee = 0.1 * 1e9; // in nanomina (1 billion = 1.0 mina)
Mina.setActiveInstance(Network);

await fetchAccount(zkAppAddress);
let zkApp = new MinaMix(zkAppAddress);

console.log(`Using MinaMix contract deployed at ${zkApp.address}`)

// Compile the contract to create prover keys
console.log('Compiling the contract...');
await MinaMix.compile();
console.log('Contract was compiled');

let depositTx;
let withdrawTx;

// Generate a secret and a nullifier for depositing
let secret = Field.random();
let nullifier = Nullifier.fromJSON(
    Nullifier.createTestNullifier(
        [Field(nullifierMessage)],
        PrivateKey.random()
    )
);

// DEPOSIT TRANSACTION
try {

    // Build the deposit tree off-chain
    console.log('building deposit tree')
    const DepositTree = new MerkleTree(TREE_HEIGHT);

    let witness = DepositTree.getWitness(0n);
    let path = new MinaMixMerkleWitness(witness);

    // call deposit() and send transaction
    console.log('build deposit transaction and create proof...');
    let tx = await Mina.transaction({ sender: depositorAddress, fee }, () => {
        zkApp.deposit(secret, nullifier, path);
    });
    await tx.prove();
    console.log('send transaction...');
    depositTx = await tx.sign([depositorPrivateKey]).send();

    const events = await zkApp.fetchEvents(UInt32.from(startBlock));

    console.log(events)

} catch (err) {
    console.log(err);
}
if (depositTx?.hash() !== undefined) {
    console.log(`
    Success! Deposit transaction sent.

    MinaMix smart contract state will be updated
    as soon as the transaction is included in a block:
    https://berkeley.minaexplorer.com/transaction/${depositTx.hash()}
    `);
}

// WITHDRAW TRANSACTION
try {
    let commitment = Poseidon.hash([secret, nullifier.key()]);

    // Build the deposit tree off-chain
    console.log('building deposit tree')
    const DepositTree = new MerkleTree(TREE_HEIGHT);

    let witness = DepositTree.getWitness(0n);
    let path = new MinaMixMerkleWitness(witness);

    // call deposit() and send transaction
    console.log('build deposit transaction and create proof...');
    let tx = await Mina.transaction({ sender: depositorAddress, fee }, () => {
        zkApp.deposit(secret, nullifier, path);
    });
    await tx.prove();
    console.log('send transaction...');
    withdrawTx = await tx.sign([depositorPrivateKey]).send();

    const events = await zkApp.fetchEvents(UInt32.from(startBlock));

    console.log(events)

} catch (err) {
    console.log(err);
}
if (withdrawTx?.hash() !== undefined) {
    console.log(`
    Success! Deposit transaction sent.

    MinaMix smart contract state will be updated
    as soon as the transaction is included in a block:
    https://berkeley.minaexplorer.com/transaction/${withdrawTx.hash()}
    `);
}
