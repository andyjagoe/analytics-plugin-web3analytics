# Web3 Analytics Plugin
This is a [plugin](https://getanalytics.io/plugins/) for [Analytics](https://getanalytics.io/), a lightweight open-source frontend analytics abstraction layer. The plugin enables sending data to [Web3 Analytics](http://web3analytics.network/), a decentralized analytics platform for web3 apps.

## Installation

```
npm install analytics
npm install analytics-plugin-web3analytics
```

## Usage

```js
import Analytics from 'analytics';
import web3Analytics from 'analytics-plugin-web3analytics';

/* Initialize analytics & load plugins */
const analytics = Analytics({
  app: 'awesome-app',
  plugins: [
    web3Analytics({
      appId: YOUR_WEB3ANALYTICS_APP_ID,
      jsonRpcUrl: 'https://eth-goerli.g.alchemy.com/v2/your_key_here'
    })
  ]
})

```

## License

Apache-2.0 OR MIT