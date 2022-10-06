import { CeramicClient } from '@ceramicnetwork/http-client'
import { TileLoader } from '@glazed/tile-loader'
import { DID } from 'dids';
import { Secp256k1Provider } from 'key-did-provider-secp256k1'
import KeyResolver from 'key-did-resolver'
import { DataModel } from '@glazed/datamodel'
import { DIDDataStore } from '@glazed/did-datastore'
import modelAliases from './model.json'
import { JsonRpcProvider, Contract, isAddress } from 'essential-eth'  // 2x as fast as ethers
import { JsonRpcProvider as EthersJsonRpcProvider, Web3Provider } from '@ethersproject/providers'
import { Contract as EthersContract } from '@ethersproject/contracts'
import { Wallet } from '@ethersproject/wallet'
import { RelayProvider } from "@opengsn/provider"
import { WrapBridge } from "@opengsn/provider/dist/WrapContract"
import { Eip1193Bridge } from "@ethersproject/experimental"
import { toString as u8aToString } from 'uint8arrays'
import Web3AnalyticsABI from "./Web3AnalyticsABI.json"
import flatten from 'flat'
import log from 'loglevel'

log.setDefaultLevel("error")


// Contract Addresses
const WEB3ANALYTICS_ADDRESS = '0x25874Dd2dE546eF0D9c0D247Ea6CA0AF1F362941'
const WEB3ANALYTICS_PAYMASTER_ADDRESS = '0x487316eff97A1F71dd1779FEb5D1265a5C0E11aD'

// Set up Ceramic
const ceramic = new CeramicClient('https://ceramic-clay.3boxlabs.com')
const cache = new Map()
const loader = new TileLoader({ ceramic, cache })
const model = new DataModel({ loader, model: modelAliases })
const dataStore = new DIDDataStore({ ceramic, loader, model })



export default function web3Analytics(userConfig) {
  const appId = userConfig.appId
  const jsonRpcUrl = userConfig.jsonRpcUrl
  const logLevel = userConfig.logLevel
  setLoglevel()


  let authenticatedDID
  let q_ = Promise.resolve();


  function setLoglevel() {
    if (logLevel && logLevel.toString().toUpperCase() in log.levels) log.setLevel(logLevel, false)
  }

  // `seed` must be a 32-byte long Uint8Array
  async function authenticateCeramic(seed) {
      const provider = new Secp256k1Provider(seed)
      const did = new DID({ provider, resolver: KeyResolver.getResolver() })
      log.debug(did)

      // Authenticate the DID with the provider
      await did.authenticate()
      log.debug(did);

      // The Ceramic client can create and update streams using the authenticated DID
      ceramic.did = did

      return did;
  }

  async function checkAppRegistration() {
    if (!isAddress(appId)) return false;
    const provider = new JsonRpcProvider(jsonRpcUrl)
    const contract = await new
    Contract(
      WEB3ANALYTICS_ADDRESS, 
      Web3AnalyticsABI,
      provider
    )
    return contract.isAppRegistered(appId)
  }

  async function checkUserRegistration(signer) {
    const provider = new JsonRpcProvider(jsonRpcUrl)
    const contract = await new
    Contract(
      WEB3ANALYTICS_ADDRESS, 
      Web3AnalyticsABI,
      provider
    )
    return contract.isUserRegistered(appId, signer.address)
  }

  async function registerUser(privateKey, did) {
    log.debug(did)

    // OpenGSN config
    const signer = new Wallet(privateKey)
    const gsnProvider = RelayProvider.newProvider(
      {
        provider: new WrapBridge(new Eip1193Bridge(signer, new EthersJsonRpcProvider(jsonRpcUrl))), 
        config: { 
          paymasterAddress: WEB3ANALYTICS_PAYMASTER_ADDRESS,
          loggerConfiguration: {
            logLevel: "error"
          }   
        }
      })
    await gsnProvider.init()

    gsnProvider.addAccount(signer.privateKey)
    const provider = new Web3Provider(gsnProvider)

    const contract = await new EthersContract (
      WEB3ANALYTICS_ADDRESS, 
      Web3AnalyticsABI,
      provider.getSigner(signer.address, signer.privateKey)
    )

    log.info(`Registering user Address: ${signer.address} did: ${did}`)
    
    const transaction = await contract.addUser(
      did, 
      appId,
      {gasLimit: 1e6}
    )

    setLoglevel() // Needed b/c winston (opengsn) messes w/ console.log & loglevel loses it
    log.debug(transaction)
    const receipt = await provider.waitForTransaction(transaction.hash)
    log.debug(receipt)
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
      log.error(err)
    }
    flattened.raw_payload = JSON.stringify(payload)

    log.debug(flattened);

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
    log.debug(`New document id: ${docID}`)

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
      authenticatedDID = await authenticateCeramic(seed)
      localStorage.setItem('authenticatedDID', authenticatedDID.id);

      // Check app registration
      const isAppRegistered = await checkAppRegistration();
      if (!isAppRegistered) {
        log.info(`${ appId } is not a registered app. Tracking not enabled.`)
        return;
      }
      log.info(`App is Registered: ${appId}`)

      // Check user registration 
      // TODO: allow tracking before user is registered? put this in a separate worker thread?
      const signer = new Wallet(privateKey)
      const isUserRegistered = await checkUserRegistration(signer)

      if (!isUserRegistered) {
        log.info(`User not registered. Attempting to register.`)
        registerUser(privateKey, authenticatedDID.id)
      } else {
        log.info(`User is registered.`)
      }
  
      // enable tracking      
      window.web3AnalyticsLoaded = true 

      // Report ceramic event count TODO: remove this when upgrade ceramic
      //const newEvents = await dataStore.get('events')
      //log.debug(newEvents)
      
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