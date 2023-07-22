import { 
    method, 
    state, 
    AccountUpdate,
    Circuit, 
    Field,
    MerkleMap,
    MerkleMapWitness, 
    MerkleWitness, 
    Nullifier, 
    Poseidon,
    PublicKey,  
    SmartContract,
    State, 
    UInt64
} from 'snarkyjs';

// Setting the height of the Merkle trees
class MinaMixMerkleWitness extends MerkleWitness(20) {}

/**
 * MinaMix basic implementation 
 * 
 * Implemets the basic logic for a funds mixer. Users can deposit their funds into the mixer via the `deposit` function,
 * and withdraw them anonymously via the `withdraw` function. THe quantity that is transacted is fixed by the 
 * `denomination` variable.
 * 
 * Développé avec ❤️ pour le Hackathon d'ETHGlobal Paris 🇫🇷 2023
 */
export class MinaMix extends SmartContract {
    // Denomination -- fixed value that is sent and withdrawn from the mixer
    @state(Field) denomination = State<Field>();
    
    // Deposit tree root
    @state(Field) depositRoot = State<Field>();

    // Nullifier tree root
    @state(Field) nullifierHashRoot = State<Field>();

    // Nullifier message -- set to this contract's public key to prevent replay attacks
    @state(Field) nullifierMessage = State<Field>();

    // Events that are used to build the deposit tree off-chain
    events = {
        'commitment-added': Field,  // Makes the deposit commitment public
        'new-deposit-root': Field,  // Makes the new deposit tree root public
    };

    /**
     * Allows users to deposit funds into the mixer.
     * 
     * @param secret: private value that allows users to remain custodians of their assets.
     * @param nullifier: private value used to prevent double spending. The nullifier must be 
     * created inside the user's wallet so the private key never leaves that enclave.
     * @param path: Merkle path used to update the on-chain deposits Merkle tree.
     */
    @method deposit(secret: Field, nullifier: Nullifier, path: MinaMixMerkleWitness) {
        // Transfer a `denomination` amount into the contract
        let denomination = this.denomination.getAndAssertEquals();
        let senderUpdate = AccountUpdate.createSigned(this.sender);
        senderUpdate.send({ to: this, amount: UInt64.from(denomination) });

        // Compute the commitment = Hash(secret, nullifier)
        let commitment = Poseidon.hash([secret, nullifier.key()]);

        // Verify Merkle path given for the deposit tree is correct -- leaf is currently empty
        let depositRoot = this.depositRoot.getAndAssertEquals();
        path.calculateRoot(new Field(0)).assertEquals(depositRoot);

        // Add computed commitment to the deposit tree and update it
        let newDepositRoot = path.calculateRoot(commitment);
        this.depositRoot.set(newDepositRoot);

        // Emit events to be able to build the deposit tree off-chain
        this.emitEvent('commitment-added', commitment);
        this.emitEvent('new-deposit-root', newDepositRoot);
    };

    /**
     * Allows users to withdraw their funds from the mixer.
     * 
     * @param secret: the private value that was used to deposit funds in the first place.
     * @param nullifier: used to prevent double spending, the hash of this value will be voided
     * so future withdraw transactions cannot use the same nullifier.
     * @param path : Merkle path used to verify that the user made an original deposit into the
     * mixer.
     * @param recipient: Address that will receive the funds. Specifying this separately allows
     * for transaction relayers to perform this `withdraw` transaction to increase anonimity.
     */
    @method withdraw(secret: Field, nullifier: Nullifier, path: MinaMixMerkleWitness, recipient: PublicKey) {
        // Compute the commitment = Hash(secret, nullifier)
        let commitment = Poseidon.hash([secret, nullifier.key()]);

        // Verify the commitment exists within the deposit tree via the provided Merkle path
        let depositRoot = this.depositRoot.getAndAssertEquals();
        path.calculateRoot(commitment).assertEquals(depositRoot);

        // Verify that the nullifier has not been voided yet
        let nullifierHashRoot = this.nullifierHashRoot.getAndAssertEquals();
        let nullifierMessage = this.nullifierMessage.getAndAssertEquals();
        nullifier.verify([nullifierMessage]);

        const NullifierTree = new MerkleMap();  // initializes an empty nullifier tree

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
    };
};
