import { 
    AccountUpdate, 
    Field, 
    MerkleMap, 
    MerkleTree, 
    MerkleWitness, 
    Mina, 
    Nullifier, 
    Poseidon,
    PrivateKey, 
    PublicKey, 
} from 'snarkyjs';
import { MinaMix } from './MinaMix';

let proofsEnabled = false;

const DENOMINATION = BigInt(1 * 1e9);
const TREE_HEIGHT = 20;
class MinaMixMerkleWitness extends MerkleWitness(TREE_HEIGHT) {};

describe('MinaMix', () => {
    let denomination: Field,
        deployerAccount: PublicKey,
        deployerKey: PrivateKey,
        senderAccount: PublicKey,
        senderKey: PrivateKey,
        recipientAccount: PublicKey,
        recipientKey: PrivateKey,
        zkAppAddress: PublicKey,
        zkAppPrivateKey: PrivateKey,
        zkApp: MinaMix;

    let secret: Field,
        privilegedKey: PrivateKey,
        nullifier: Nullifier,
        path: MinaMixMerkleWitness;

    const DepositTree = new MerkleTree(TREE_HEIGHT);
    const NullifierTree = new MerkleMap();

    beforeAll(async () => {
        if (proofsEnabled) await MinaMix.compile();
    });

    beforeEach(() => {
        const Local = Mina.LocalBlockchain({ proofsEnabled });
        Mina.setActiveInstance(Local);
        ({ privateKey: deployerKey, publicKey: deployerAccount } =
            Local.testAccounts[0]);
        ({ privateKey: senderKey, publicKey: senderAccount } =
            Local.testAccounts[1]);
        ({ privateKey: recipientKey, publicKey: recipientAccount } = 
            Local.testAccounts[2]);
            
        zkAppPrivateKey = PrivateKey.random();
        zkAppAddress = zkAppPrivateKey.toPublicKey();
        zkApp = new MinaMix(zkAppAddress);        

        denomination = Field(DENOMINATION);

        secret = Field.random();

        privilegedKey = PrivateKey.random();

        nullifier = Nullifier.fromJSON(
            Nullifier.createTestNullifier(
                [zkAppAddress.toFields()[0]],
                privilegedKey
            )
        );
        
        let witness = DepositTree.getWitness(0n);
        path = new MinaMixMerkleWitness(witness);
    });

    async function localDeploy() {
        const txn = await Mina.transaction(deployerAccount, () => {
            AccountUpdate.fundNewAccount(deployerAccount);
            zkApp.deploy();

            zkApp.denomination.set(denomination);
            zkApp.depositRoot.set(DepositTree.getRoot());
            zkApp.nullifierHashRoot.set(NullifierTree.getRoot());
            zkApp.nullifierMessage.set(zkAppAddress.toFields()[0]);  // prevents replay attacks
        });
        await txn.prove();
        
        // This tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
        await txn.sign([deployerKey, zkAppPrivateKey]).send();
    };

    it('generates and deploys the `MinaMix` smart contract', async () => {
        await localDeploy();
        expect(zkApp.address).toEqual(zkAppAddress);

        // Public values get initialized correctly
        expect(zkApp.denomination.get()).toEqual(denomination);
        expect(zkApp.depositRoot.get()).toEqual(DepositTree.getRoot());
        expect(zkApp.nullifierHashRoot.get()).toEqual(NullifierTree.getRoot());
        expect(zkApp.nullifierMessage.get()).toEqual(zkAppAddress.toFields()[0]);
    });

    describe('deposit', () => {
        beforeEach(async () => {
            await localDeploy();
        });

        it('sends a `denomination` amount to the contract', async () => {
            let startBalance = Mina.getAccount(senderAccount).balance;

            let tx = await Mina.transaction(senderAccount, () => {
                zkApp.deposit(secret, nullifier, path);
            });
            await tx.prove();
            await tx.sign([senderKey]).send();

            let endBalance = Mina.getAccount(senderAccount).balance;

            // Sender's balance is decreased
            expect(startBalance.sub(endBalance).toBigInt()).toEqual(DENOMINATION);

            // Contract's balance is increased
            let contractBalance = Mina.getAccount(zkAppAddress).balance;
            expect(contractBalance.toBigInt()).toEqual(DENOMINATION);
        });

        it('updates the deposit tree root', async () => {
            // Before adding the commitment -- empty tree root
            const NewDepositTree = new MerkleTree(TREE_HEIGHT);
            expect(zkApp.depositRoot.get()).toEqual(NewDepositTree.getRoot());

            let tx = await Mina.transaction(senderAccount, () => {
                zkApp.deposit(secret, nullifier, path);
            });
            await tx.prove();
            await tx.sign([senderKey]).send();

            const commitment = Poseidon.hash([secret, nullifier.key()]);
            NewDepositTree.setLeaf(0n, commitment);

            // After adding the commitment -- updated tree root
            expect(zkApp.depositRoot.get()).toEqual(NewDepositTree.getRoot());
        });

        it('emits events to be able to build the deposit tree off-chain', async () => {
            let tx = await Mina.transaction(senderAccount, () => {
                zkApp.deposit(secret, nullifier, path);
            });
            await tx.prove();
            await tx.sign([senderKey]).send();

            let events = await zkApp.fetchEvents();

            const NewDepositTree = new MerkleTree(TREE_HEIGHT);
            let commitment = Poseidon.hash([secret, nullifier.key()]);
            NewDepositTree.setLeaf(0n, commitment);

            // New commitment is emitted correctly
            expect(events[1].type).toEqual(
                'commitment-added'
            )
            expect(events[1].event.data.toString()).toEqual(
                commitment.toString()
            )

            // Tree root is emitted correctly
            expect(events[0].type).toEqual(
                'new-deposit-root'
            )
            expect(events[0].event.data.toString()).toEqual(
                NewDepositTree.getRoot().toString()
            )
        });

        it('reverts when given the wrong Merkle path', async () => {
            let tx = await Mina.transaction(senderAccount, () => {
                zkApp.deposit(secret, nullifier, path);
            });
            await tx.prove();
            await tx.sign([senderKey]).send();

            // Now the leaf at index 0 is filled -- the Merkle proof is not valid anymore
            await expect(async () => {
                zkApp.deposit(secret, nullifier, path)
            }).rejects.toThrow();
        });
    });

    describe('withdraw', () => {
        beforeEach(async () => {
            await localDeploy();
            
            // Deposit tx
            let tx = await Mina.transaction(senderAccount, () => {
                zkApp.deposit(secret, nullifier, path);
            });
            await tx.prove();
            await tx.sign([senderKey]).send();
        });

        it('sends the funds to the `recipient` address', async () => {
            let startBalance = Mina.getAccount(recipientAccount).balance;

            let tx = await Mina.transaction(recipientAccount, () => {
                zkApp.withdraw(secret, nullifier, path, recipientAccount);
            });
            await tx.prove();
            await tx.sign([recipientKey]).send();

            let endBalance = Mina.getAccount(recipientAccount).balance;

            // Recipient's balance is increased
            expect(endBalance.sub(startBalance).toBigInt()).toEqual(DENOMINATION);

            // Contract's balance is decreased
            let contractBalance = Mina.getAccount(zkAppAddress).balance;
            expect(contractBalance.toBigInt()).toEqual(0n);
        });

        it('reverts when given the wrong Merkle proof', async () => {
            const NewDepositTree = new MerkleTree(TREE_HEIGHT);
            let commitment = Poseidon.hash([secret, nullifier.key()]);
            NewDepositTree.setLeaf(0n, commitment);

            // Generating a Merkle proof for the wrong index -- the second item in the tree
            let witness = NewDepositTree.getWitness(1n);
            let wrongPath = new MinaMixMerkleWitness(witness);

            await expect(async () => {
                zkApp.withdraw(secret, nullifier, wrongPath, recipientAccount)
            }).rejects.toThrow();
        });

        it('reverts when the nullifier has already been used', async () => {
            let tx = await Mina.transaction(recipientAccount, () => {
                zkApp.withdraw(secret, nullifier, path, recipientAccount);
            });
            await tx.prove();
            await tx.sign([recipientKey]).send();

            // After withdrawing the nullifier is voided -- it cannot be used again
            await expect(async () => {
                zkApp.withdraw(secret, nullifier, path, recipientAccount)
            }).rejects.toThrow();
        });
    });
});
