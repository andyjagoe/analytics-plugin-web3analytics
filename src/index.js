import { ComposeClient } from '@composedb/client'
import { definition } from './definition.js'
import { DID } from 'dids';
import { Secp256k1Provider } from 'key-did-provider-secp256k1'
import KeyResolver from 'key-did-resolver'
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


const WEB3ANALYTICS_ADDRESS = '0xd00CCD251869086eCD8B54f328Df1d623369b8F6'
const WEB3ANALYTICS_PAYMASTER_ADDRESS = '0x1A387Db642a76bEE516f1e16F542ed64ee81772c'
//const CERAMIC_ADDRESS = 'https://ceramic-clay.3boxlabs.com'
const CERAMIC_ADDRESS = 'http://localhost:7007'


// Set up Ceramic ComposeDB
const compose = new ComposeClient({ ceramic: CERAMIC_ADDRESS, definition })


/**
 * web3Analytics v3 plugin
 * @param {object}  userConfig - Plugin settings
 * @param {string}  pluginConfig.appId - The app ID (an ETH address) you received from web3 analytics (required)
 * @param {string}  pluginConfig.jsonRpcUrl - Your JSON RPC url (required)
 * @param {string}  pluginConfig.logLevel - Log level may be debug, info, warn, error (default). Param is optional
 * @example
 *
 * web3Analytics({
 *   appId: 'YOUR_APP_ID',
 *   jsonRpcUrl: 'YOUR_JSONRPC_URL'
 * })
 */

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

      // The ComposeDB client can create and update streams using the authenticated DID
      compose.setDID(did)

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
            logLevel: "debug"
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
      appId
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
    // Flatten payload and add original as json string
    let flattened = payload
    try {
      flattened = flatten(payload, {delimiter:'_'})
    } catch (err) {
      log.error(err)
    }

    let cdbVariables = {
      app_id: appId,
      did: authenticatedDID.id,
      created_at: (new Date()).toISOString(),
      updated_at: Date.now(),
      raw_payload: JSON.stringify(payload)
    }
    if (flattened.anonymousId) cdbVariables.anonymousId = flattened.anonymousId
    if (flattened.event) cdbVariables.event = flattened.event
    if (flattened.meta_ts) cdbVariables.meta_ts = payload.meta.ts.toString()
    if (flattened.meta_rid) cdbVariables.meta_rid = flattened.meta_rid
    if (flattened.properties_url) cdbVariables.properties_url = flattened.properties_url
    if (flattened.properties_hash) cdbVariables.properties_hash = flattened.properties_hash
    if (flattened.properties_path) cdbVariables.properties_path = flattened.properties_path
    if (flattened.properties_title) cdbVariables.properties_title = flattened.properties_title
    if (flattened.properties_referrer) cdbVariables.properties_referrer = flattened.properties_referrer
    if (flattened.properties_search) cdbVariables.properties_search = flattened.properties_search
    if (flattened.properties_width) cdbVariables.properties_width = flattened.properties_width
    if (flattened.properties_height) cdbVariables.properties_height = flattened.properties_height
    if (flattened.traits_email) cdbVariables.traits_email = flattened.traits_email
    if (flattened.type) cdbVariables.type = flattened.type
    if (flattened.userId) cdbVariables.userId = flattened.userId    
    log.debug(cdbVariables);

    // Create Event using ComposeDB
    const createResult = await compose.executeQuery(`
        mutation CreateNewEvent($i: CreateEventInput!){
            createEvent(input: $i){
                document{
                    id
                }
            }
        }
    `,
      {
        "i": {
          "content": cdbVariables
        }
      }
    )
    log.debug(JSON.stringify(createResult, null, 2))
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
      // TODO: allow tracking while user is being registered? put this in a web worker?
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