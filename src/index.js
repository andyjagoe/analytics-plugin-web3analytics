import { CeramicClient } from '@ceramicnetwork/http-client'
import { TileLoader } from '@glazed/tile-loader'
import { DID } from 'dids';
import { Secp256k1Provider } from 'key-did-provider-secp256k1'
import KeyResolver from 'key-did-resolver'
import { DataModel } from '@glazed/datamodel'
import { DIDDataStore } from '@glazed/did-datastore'
import { JsonRpcProvider, Web3Provider } from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import { isAddress } from '@ethersproject/address'
import { Wallet } from '@ethersproject/wallet'
import { toString as u8aToString } from 'uint8arrays'
import modelAliases from './model.json'
import { RelayProvider } from "@opengsn/provider"
//import { wrapContract } from "@opengsn/provider/dist/WrapContract"
import { WrapBridge } from "@opengsn/provider/dist/WrapContract"
import { Eip1193Bridge } from "@ethersproject/experimental"

import Web3AnalyticsABI from "./Web3AnalyticsABI.json"
//import Web3HttpProvider from 'web3-providers-http'
import flatten from 'flat'


// Contract Addresses
const WEB3ANALYTICS_ADDRESS = '0x19149a1b01D908388809fAF8956955F41C32C02F'
const WEB3ANALYTICS_PAYMASTER_ADDRESS = '0x7b18C48FC799196325D74571034066C1491ff8Af'

// Set up Ceramic
const ceramic = new CeramicClient('https://ceramic-clay.3boxlabs.com')
const cache = new Map()
const loader = new TileLoader({ ceramic, cache })
const model = new DataModel({ loader, model: modelAliases })
const dataStore = new DIDDataStore({ ceramic, loader, model })



export default function web3Analytics(userConfig) {
  const appId = userConfig.appId
  const jsonRpcUrl = userConfig.jsonRpcUrl
  let authenticatedDID
  let q_ = Promise.resolve();


  // `seed` must be a 32-byte long Uint8Array
  async function authenticateCeramic(seed) {
      const provider = new Secp256k1Provider(seed)
      const did = new DID({ provider, resolver: KeyResolver.getResolver() })
      console.log(did)

      // Authenticate the DID with the provider
      await did.authenticate()
      console.log(did);

      // The Ceramic client can create and update streams using the authenticated DID
      ceramic.did = did

      return did;
  }

  async function checkAppRegistration() {
    if (!isAddress(appId)) return false;
    const provider = new JsonRpcProvider(jsonRpcUrl);
    const contract = await new
    Contract(
      WEB3ANALYTICS_ADDRESS, 
      Web3AnalyticsABI,
      provider
    )
    return contract.isAppRegistered(appId)
  }


  async function registerUser(privateKey, did) {
    console.log(did)

    // OpenGSN config
    /*
    const gsnConfig = {
      paymasterAddress: WEB3ANALYTICS_PAYMASTER_ADDRESS
    }

    const web3provider = new Web3HttpProvider(jsonRpcUrl)

    const gsnProvider = RelayProvider.newProvider({provider: web3provider, config: gsnConfig})
    await gsnProvider.init()

    const signer = new Wallet(privateKey)
    gsnProvider.addAccount(signer.privateKey)

    const provider = new Web3Provider(gsnProvider)

    const contract = await new Contract (
      WEB3ANALYTICS_ADDRESS, 
      Web3AnalyticsABI,
      provider.getSigner(signer.address, signer.privateKey)
    )

    // Check if user is already registered
    const isRegistered = await contract.isUserRegistered(appId);
    if (isRegistered) {
      console.log(`User is registered. Address: ${signer.address} did: ${did}`)
      return;
    }

    console.log(`Registering user Address: ${signer.address} did: ${did}`)

    // If user is not registered, process now
    const transaction = await contract.addUser(
      did, 
      appId,
      {gasLimit: 1e6}
    )
    console.log(transaction)
    const receipt = await provider.waitForTransaction(transaction.hash)
    console.log(receipt)

    */


    // try with ethers only
    /*

    const confStandard = { 
      paymasterAddress: WEB3ANALYTICS_PAYMASTER_ADDRESS,
    }
  
    const provider = new JsonRpcProvider(jsonRpcUrl)
    const signer = new Wallet(privateKey, provider)
    console.log(signer)

    const eip1193Provider = new Eip1193Bridge(signer, provider)
    console.log(eip1193Provider)

    const p = new Web3Provider(eip1193Provider)
    console.log(p)


    const contract = await new Contract(
      WEB3ANALYTICS_ADDRESS, 
      Web3AnalyticsABI,
      p.getSigner(signer.address, signer.privateKey)
    )
    console.log(contract)

  
    const gsnContract = await wrapContract(contract, confStandard)
    console.log(gsnContract)


    // Check if user is already registered
    const isRegistered = await gsnContract.isUserRegistered(appId);
    if (isRegistered) {
      console.log(`User is registered. Address: ${signer.address} did: ${did}`)
      return;
    }

    console.log(`Registering user Address: ${signer.address} did: ${did}`)

    // If user is not registered, process now
    const transaction = await gsnContract.addUser(
      did, 
      appId,
      {gasLimit: 1e6}
    )
    console.log(transaction)
    const receipt = await provider.waitForTransaction(transaction.hash)
    console.log(receipt)
    */

    // New try w/o web3.js
    const signer = new Wallet(privateKey)
    const gsnProvider = RelayProvider.newProvider(
      {
        provider: new WrapBridge(new Eip1193Bridge(signer, new JsonRpcProvider(jsonRpcUrl))), 
        config: { paymasterAddress: WEB3ANALYTICS_PAYMASTER_ADDRESS }
      })
    await gsnProvider.init()

    gsnProvider.addAccount(signer.privateKey)
    const provider = new Web3Provider(gsnProvider)

    const contract = await new Contract (
      WEB3ANALYTICS_ADDRESS, 
      Web3AnalyticsABI,
      provider.getSigner(signer.address, signer.privateKey)
    )

    // Check if user is already registered
    const isRegistered = await contract.isUserRegistered(appId);
    if (isRegistered) {
      console.log(`User is registered. Address: ${signer.address} did: ${did}`)
      return;
    }

    console.log(`Registering user Address: ${signer.address} did: ${did}`)

    // If user is not registered, process now
    const transaction = await contract.addUser(
      did, 
      appId,
      {gasLimit: 1e6}
    )
    console.log(transaction)
    const receipt = await provider.waitForTransaction(transaction.hash)
    console.log(receipt)


  }

  function queue(fn) {
    q_ = q_.then(fn);
    return q_;
  }

  async function sendEvent(payload, authenticatedDID) {
    // Add data to Event payload
    const ts = payload.meta.ts
    payload.meta.ts = ts.toString()
    payload.updated_at = Date.now()
    payload.created_at = (new Date()).toISOString()
    payload.app_id = appId
    payload.did = authenticatedDID.id

    // Flatten payload and add original as json string
    let flattened = payload
    try {
      flattened = flatten(payload, {delimiter:'_'})
    } catch (err) {
      console.log(err)
    }
    flattened.raw_payload = JSON.stringify(payload)

    console.log(flattened);

    // Create Event in Ceramic
    const [doc, eventsList] = await Promise.all([
        model.createTile('Event', flattened),
        dataStore.get('events'),
    ])

    // Make ID of Event object part of the object itself
    const content = doc.content
    content.id = doc.id.toString()
    await doc.update(content)

    // Add Event object to Events index
    const events = eventsList?.events ?? []
    await dataStore.set('events', {
        events: [...events, { id: doc.id.toUrl(), updated_at: ts }],
    })

    // Report update to console
    const docID = doc.id.toString()
    console.log(`New document id: ${docID}`)

  }
  
    
  // Return object for analytics to use
  return {
    name: 'web3analytics',
    config: {},
    initialize: async ({ config }) => {
      let seed;

      const ceramicSeed = JSON.parse(localStorage.getItem('ceramicSeed'));
      if (!ceramicSeed) {
          // Create new seed
          seed = crypto.getRandomValues(new Uint8Array(32));
          localStorage.setItem('ceramicSeed', JSON.stringify(Array.from(seed)));
      } else {
          // Use existing seed
          seed = new Uint8Array(JSON.parse(localStorage.getItem('ceramicSeed')));
      }
      
      const privateKey = "0x"+ u8aToString(seed, 'base16')

      // Authenticate Ceramic
      authenticatedDID = await authenticateCeramic(seed);
      localStorage.setItem('authenticatedDID', authenticatedDID.id);

      const isAppRegistered = await checkAppRegistration();
      if (!isAppRegistered) {
        console.log(`${ appId } is not a registered app. Tracking not enabled.`);
        return;
      }
      console.log(`App is Registered: ${appId}`)

      // Check event count
      const newEvents = await dataStore.get('events')
      console.log(newEvents)

      // attempt to register user on blockchain
      registerUser(privateKey, authenticatedDID.id);
      
      window.web3AnalyticsLoaded = true;  
      
    },
    page: async ({ payload }) => {
      queue(sendEvent.bind(null, payload, authenticatedDID));
    },
    track: async ({ payload }) => {
      queue(sendEvent.bind(null, payload, authenticatedDID));
    },
    identify: async ({ payload }) => {
      queue(sendEvent.bind(null, payload, authenticatedDID));
    },
    loaded: () => {
      return !!window.web3AnalyticsLoaded;
    }
  }
}