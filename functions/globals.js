// globals.js
// https://stackoverflow.com/questions/5447771/node-js-global-variables
const functions = require('firebase-functions');

// 1.4 leagues
// 1.5 event.js, league.js, action.js, push.js
const API_VERSION = 2.0
const BUILD_VERSION = 153 // for internal tracking

// TO TOGGLE BETWEEN DEV AND PROD: change this to .dev or .prod for functions:config variables to be correct
const config = functions.config().dev

// exports are used like: globals.isDev, globals.apiKey, globals.stripeToken
module.exports = {
	isDev : config.panna.environment == "dev",
	apiKey : config.firebase.api_key,
	stripeToken : config.stripe.token,
	apiVersion : API_VERSION,
	buildVersion: BUILD_VERSION
}

// https://evdokimovm.github.io/javascript/nodejs/2016/06/13/NodeJS-How-to-Use-Functions-from-Another-File-using-module-exports.html
doSecondsSince1970 = function() {
    var secondsSince1970 = new Date().getTime() / 1000
    return Math.floor(secondsSince1970)
}

module.exports.secondsSince1970 = function() {
	return doSecondsSince1970()
}

module.exports.createUniqueId = function() {
    var secondsSince1970 = doSecondsSince1970()
    var randomId = Math.floor(Math.random() * 899999 + 100000)
    return `${secondsSince1970}-${randomId}`
}

// enums
const ActionType = {
	chat: "chat",
	createEvent: "createEvent",
    joinEvent: "joinEvent",
    leaveEvent: "leaveEvent",
    addedToEvent: "addedToEvent",
    removedFromEvent: "removedFromEvent",
    
    // league
    joinLeague: "joinLeague",
    leaveLeague: "leaveLeague",
    
    // payment
    holdPaymentForEvent: "holdPaymentForEvent",
    payForEvent: "payForEvent",
    stripeConnectChargeForEvent: "stripeConnectChargeForEvent",

    // cancel event
    cancelEvent: "cancelEvent",
    uncancelEvent: "uncancelEvent",

    // venues
    createVenue: "createVenue",
    
    systemMessage: "systemMessage"
}

module.exports.ActionType = ActionType