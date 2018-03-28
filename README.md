Etheradmin
==========

Simple Ethereum admin page extracted from the [Ethereum Proof-of-Work Consortium solution template](https://azuremarketplace.microsoft.com/en-us/marketplace/apps/microsoft-azure-blockchain.azure-blockchain-ethereum?tab=Overview) but with added configurable basic HTTP auth.

To run:

```
 node.js [listenPort] [gethIPCPath] [coinbase] [coinbasePw] [coinbasePw] [consortiumId] [consortiumId] [registrarHostEndpoint] [registrarConnectionString] [registrarDatatbaseId] [registrarCollectionId] [basicAdminPassword]
```

Main difference with marketplace template app is the addition of *basicAdminPassword*.


