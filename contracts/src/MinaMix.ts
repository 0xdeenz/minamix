import { Field, Poseidon, SmartContract, state, State, method, MerkleWitness, PublicKey, AccountUpdate, UInt64, Nullifier, Circuit, MerkleMapWitness, MerkleMap } from 'snarkyjs';

// Setting the height of the Merkle trees to be 20
class MinaMixMerkleWitness extends MerkleWitness(20) {}

const NullifierTree = new MerkleMap();

/**
 * MinaMix basic implementation
 * 
 * 
 * 
 * Built during ETHGlobal Paris 2023
 */
export class MinaMix extends SmartContract {
    // Denomination -- fixed value that is sent and withdrawn from the mixer
    @state(Field) denomination = State<Field>();
    
    // Deposit tree root
    @state(Field) depositRoot = State<Field>();

    // Nullifier tree root
    @state(Field) nullifierHashRoot = State<Field>();

    // TODO: add events to manage which nullifiers have been used off-chain
    events = {
        'add-commitment': Field,  // Makes the deposit commitment public
        'new-deposit-root': Field,  // Makes the new deposit tree root public
    };

    /**
     * 
     * @param secret 
     * @param nullifier: the nullifier being set, created inside the user's wallet so the priate key never leaves that enclave.
     * @param path 
     */
    @method deposit(secret: Field, nullifier: Nullifier, path: MinaMixMerkleWitness) {
        // Transfer a `denomination` amount into the contract
        let denomination = this.denomination.getAndAssertEquals();
        let senderUpdate = AccountUpdate.createSigned(this.sender);
        senderUpdate.send({ to: this, amount: UInt64.from(denomination) });

        // Compute the commitment = Hash(secret, nullifier)
        let commitment = Poseidon.hash([secret, nullifier.key()]);

        // Verify Merkle path given for the deposit tree is correct
        let depositRoot = this.depositRoot.getAndAssertEquals();
        path.calculateRoot(new Field(0)).assertEquals(depositRoot);

        // Add computed commitment to the deposit tree and update it
        let newDepositRoot = path.calculateRoot(commitment);
        this.depositRoot.set(newDepositRoot);

        // Emit events to be able to build the deposit tree off-chain
        this.emitEvent('add-commitment', commitment);
        this.emitEvent('new-deposit-root', depositRoot);
    }

    @method withdraw(secret: Field, nullifier: Nullifier, path: MinaMixMerkleWitness, recipient: PublicKey) {
        // Compute the commitment = Hash(secret, nullifier)
        let commitment = Poseidon.hash([secret, nullifier.key()]);

        // Verify the commitment exists within the deposit tree via the provided Merkle path
        let depositRoot = this.depositRoot.getAndAssertEquals();
        path.calculateRoot(commitment).assertEquals(depositRoot);

        // Verify that the nullifier has not been voided yet
        let nullifierHashRoot = this.nullifierHashRoot.getAndAssertEquals();
        let nullifierMessage = Field(420);  // TODO: set it to be the pubkey of the contract
        nullifier.verify([nullifierMessage]);

        let nullifierWitness = Circuit.witness(MerkleMapWitness, () =>
            NullifierTree.getWitness(nullifier.key())
        );

        nullifier.assertUnused(nullifierWitness, nullifierHashRoot);  // ensure entry is set to 0

        // Void the nullifier to prevent double spending
        let newNullifierHashRoot = nullifier.setUsed(nullifierWitness);
        this.nullifierHashRoot.set(newNullifierHashRoot);

        // Send funds to the `recipient` address
        let denomination = this.denomination.getAndAssertEquals();
        this.send({ to: recipient, amount: UInt64.from(denomination) });
    }
}
