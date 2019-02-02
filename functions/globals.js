// globals.js
// https://stackoverflow.com/questions/5447771/node-js-global-variables
const functions = require('firebase-functions');

// 1.4 leagues
// 1.5 event.js, league.js, action.js, push.js
const API_VERSION = 1.0
const BUILD_VERSION = 124 // for internal tracking

// CONSTANT Utils //////////////////////////////////////////////////////////////////////////////////
// exports.isDev = function() {
//     return config.panna.environment == "dev"
// }
// exports.getAPIKey = function() {
//     return config.firebase.api_key
// }
// exports.stripeToken = function() {
//     return config.stripe.token
// }

// TO TOGGLE BETWEEN DEV AND PROD: change this to .dev or .prod for functions:config variables to be correct
const config = functions.config().prod

module.exports = {
	isDev : config.panna.environment == "dev",
	apiKey : config.firebase.api_key,
	stripeToken : config.stripe.token,
	apiVersion : API_VERSION,
	buildVersion: BUILD_VERSION
}