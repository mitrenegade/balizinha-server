const functions = require('firebase-functions');
const admin = require('firebase-admin');
const logging = require('@google-cloud/logging')();

// Stripe
//const config = app.config().prod // for prod environment
const config = functions.config().dev
const stripe = require('stripe')(config.stripe.token)

const currency = 'USD';

// cloud functions are all defined in index.js but they call module functions
// https://stackoverflow.com/questions/43486278/how-do-i-structure-cloud-functions-for-firebase-to-deploy-multiple-functions-fro

// [START chargecustomer]
// Charge the Stripe customer whenever an amount is written to the Realtime database
exports.createStripeCharge = functions.database.ref(`/stripe_customers/{userId}/charges/{id}`).onWrite(event => {
//function createStripeCharge(req, res, ref) {
  const val = event.data.val();
  // This onWrite will trigger whenever anything is written to the path, so
  // noop if the charge was deleted, errored out, or the Stripe API returned a result (id exists) 
  if (val === null || val.id || val.error) return null;
  // Look up the Stripe customer id written in createStripeCustomer
  return admin.database().ref(`/stripe_customers/${event.params.userId}/customer_id`).once('value').then(snapshot => {
    return snapshot.val();
  }).then(customer => {
    // Create a charge using the pushId as the idempotency key, protecting against double charges 
    const amount = val.amount;
    const idempotency_key = event.params.id;
    let charge = {amount, currency, customer};
    if (val.source !== null) charge.source = val.source;
    return stripe.charges.create(charge, {idempotency_key});
  }).then(response => {
      // If the result is successful, write it back to the database
      return event.data.adminRef.set(response);
    }, error => {
      // We want to capture errors and render them in a user-friendly way, while
      // still logging an exception with Stackdriver
      return event.data.adminRef.child('error').set(userFacingMessage(error)).then(() => {
        return reportError(error, {user: event.params.userId});
      });
    }
  );
});
// [END chargecustomer]]

// When a user deletes their account, clean up after them
exports.cleanupUser = functions.auth.user().onDelete(event => {
  return admin.database().ref(`/stripe_customers/${event.data.uid}`).once('value').then(snapshot => {
    return snapshot.val();
  }).then(customer => {
    return stripe.customers.del(customer);
  }).then(() => {
    return admin.database().ref(`/stripe_customers/${event.data.uid}`).remove();
  });
});



