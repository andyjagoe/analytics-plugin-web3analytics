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
import {publicIpv4} from 'public-ip'
import axios from 'axios'
import Web3AnalyticsABI from "./Web3AnalyticsABI.json"
import flatten from 'flat'
import log from 'loglevel'

log.setDefaultLevel("error")


const WEB3ANALYTICS_ADDRESS = '0xd00CCD251869086eCD8B54f328Df1d623369b8F6'
const WEB3ANALYTICS_PAYMASTER_ADDRESS = '0x1A387Db642a76bEE516f1e16F542ed64ee81772c'
const CERAMIC_ADDRESS = 'https://ceramic.web3analytics.network'
const GEO_API = 'https://web3analytics.network/api/ip/'


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
  let geoInfo = {}
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

  async function getGeoInfo() {
    try {
      const ip = await publicIpv4()
      log.debug("IP: ", ip)  
      const res = await axios.get(`${GEO_API}${ip}`)      
      log.debug("Geo: ", res.data)
      geoInfo = res.data
    } catch (error) {
      console.error(error)
    }
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
    // Flatten payload
    payload.geo = geoInfo
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
    if (flattened.geo_autonomousSystemNumber) cdbVariables.geo_autonomousSystemNumber 
      = flattened.geo_autonomousSystemNumber
    if (flattened.geo_autonomousSystemOrganization) cdbVariables.geo_autonomousSystemOrganization 
      = flattened.geo_autonomousSystemOrganization
    if (flattened.geo_city_geonameId) cdbVariables.geo_city_geonameId 
      = flattened.geo_city_geonameId
    if (flattened.geo_city_name) cdbVariables.geo_city_name 
      = flattened.geo_city_name
    if (flattened.geo_continent_code) cdbVariables.geo_continent_code 
      = flattened.geo_continent_code
    if (flattened.geo_continent_geonameId) cdbVariables.geo_continent_geonameId 
      = flattened.geo_continent_geonameId
    if (flattened.geo_continent_name) cdbVariables.geo_continent_name 
      = flattened.geo_continent_name
    if (flattened.geo_country_geonameId) cdbVariables.geo_country_geonameId 
      = flattened.geo_country_geonameId
    if (flattened.geo_country_isoCode) cdbVariables.geo_country_isoCode 
      = flattened.geo_country_isoCode
    if (flattened.geo_country_name) cdbVariables.geo_country_name 
      = flattened.geo_country_name
    if (flattened.geo_location_accuracyRadius) cdbVariables.geo_location_accuracyRadius 
      = flattened.geo_location_accuracyRadius
    if (flattened.geo_location_latitude) cdbVariables.geo_location_latitude 
      = flattened.geo_location_latitude
    if (flattened.geo_location_longitude) cdbVariables.geo_location_longitude 
      = flattened.geo_location_longitude
    if (flattened.geo_location_metroCode) cdbVariables.geo_location_metroCode 
      = flattened.geo_location_metroCode
    if (flattened.geo_location_timeZone) cdbVariables.geo_location_timeZone 
      = flattened.geo_location_timeZone
    if (flattened.geo_postal) cdbVariables.geo_postal 
      = flattened.geo_postal
    if (flattened.geo_registeredCountry_geonameId) cdbVariables.geo_registeredCountry_geonameId 
      = flattened.geo_registeredCountry_geonameId
    if (flattened.geo_registeredCountry_isoCode) cdbVariables.geo_registeredCountry_isoCode 
      = flattened.geo_registeredCountry_isoCode
    if (flattened.geo_registeredCountry_name) cdbVariables.geo_registeredCountry_name 
      = flattened.geo_registeredCountry_name
    if (flattened.geo_subdivision_geonameId) cdbVariables.geo_subdivision_geonameId 
      = flattened.geo_subdivision_geonameId
    if (flattened.geo_subdivision_isoCode) cdbVariables.geo_subdivision_isoCode 
      = flattened.geo_subdivision_isoCode
    if (flattened.geo_subdivision_name) cdbVariables.geo_subdivision_name 
      = flattened.geo_subdivision_name
    if (flattened.hasOwnProperty('geo_traits_isAnonymous')) cdbVariables.geo_traits_isAnonymous 
      = flattened.geo_traits_isAnonymous    
    if (flattened.hasOwnProperty('geo_traits_isAnonymousProxy')) cdbVariables.geo_traits_isAnonymousProxy 
      = flattened.geo_traits_isAnonymousProxy
    if (flattened.hasOwnProperty('geo_traits_isAnonymousVpn')) cdbVariables.geo_traits_isAnonymousVpn 
      = flattened.geo_traits_isAnonymousVpn
    if (flattened.hasOwnProperty('geo_traits_isHostingProvider')) cdbVariables.geo_traits_isHostingProvider 
      = flattened.geo_traits_isHostingProvider
    if (flattened.hasOwnProperty('geo_traits_isLegitimateProxy')) cdbVariables.geo_traits_isLegitimateProxy 
      = flattened.geo_traits_isLegitimateProxy
    if (flattened.hasOwnProperty('geo_traits_isPublicProxy')) cdbVariables.geo_traits_isPublicProxy 
      = flattened.geo_traits_isPublicProxy
    if (flattened.hasOwnProperty('geo_traits_isResidentialProxy')) cdbVariables.geo_traits_isResidentialProxy 
      = flattened.geo_traits_isResidentialProxy
    if (flattened.hasOwnProperty('geo_traits_isSatelliteProvider')) cdbVariables.geo_traits_isSatelliteProvider 
      = flattened.geo_traits_isSatelliteProvider    
    if (flattened.hasOwnProperty('geo_traits_isTorExitNode')) cdbVariables.geo_traits_isTorExitNode 
      = flattened.geo_traits_isTorExitNode    
    
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

      // get geo info
      await getGeoInfo()

      // enable tracking      
      window.web3AnalyticsLoaded = true 
      
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