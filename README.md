# MinaMix

Funds mixer for the [Mina Protocol](https://docs.minaprotocol.com/) built on [SnarkyJS](https://github.com/o1-labs/snarkyjs).

Implemets the basic logic for a funds mixer. Users can deposit their funds into the mixer via the `deposit` function, and withdraw them anonymously via the `withdraw` function. THe quantity that is transacted is fixed by the `denomination` variable.

Développé avec ❤️ pour le Hackathon d'ETHGlobal Paris 🇫🇷 2023

## Disclaimers
In case of an investigation by any federal entity or similar, this is a simple software project of academic purposes aimed to explore the applications of zero knowledge proofs and expand on their use cases. The code will be released under an Apache license and as such authors cannot be legally liable for any misapropriate use. The autonomous smart contracts (that could not qualify as a legal person) will only be deployed on test networks with **FAKE** funds, and will only be used to test that they work as per the technical specifications, and not to any other end.

![Fed Beware](./fed_beware.jpg)

## How to build

```sh
npm run build
```

## How to run tests

```sh
npm run test
npm run testw # watch mode
```

## How to run coverage

```sh
npm run coverage
```

## License

[Apache-2.0](LICENSE)
