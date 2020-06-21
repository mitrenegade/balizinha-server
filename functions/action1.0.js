const admin = require('firebase-admin');
const globals = require('./globals')
// actions
exports.createAction = function(type, userId, objectId, message, defaultMessage, exports, admin) {
    console.log("createAction type: " + type + " object id: " + objectId + " message: " + message)
    // NOTE: ref url is actions. iOS < v0.7.1 uses /action
    // This is called for event actions such as joinEvent, leaveEvent, createEvent
    // - does not include chats which are created through an action service call

    var actionId = exports.createUniqueId()

    var params = {}
    params["type"] = type
    if (type == "createVenue") {
        params["venueId"] = objectId
    } else {
        // other actions are all related to an event
        params["event"] = objectId // android 1.0.7 still uses event
        params["eventId"] = objectId // slowly transitioning to use eventId
    }
    params["user"] = userId // android 1.0.7 still uses user
    params["userId"] = userId // slowly transitioning to use userId
    params["message"] = message
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    if (defaultMessage != undefined) {
        params["defaultMessage"] = defaultMessage
    }

    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error("User for this action could not be found")
        }
        let player = snapshot.val()
        var name = player["name"]
        if (name == undefined) {
            name = player["email"] // allows players without a username to work
        }
        params["username"] = name
        var ref = `/actions/` + actionId
        console.log("Creating action in /actions with unique id " + actionId + " message: " + message + " params: " + JSON.stringify(params))
        return admin.database().ref(ref).set(params)
    }).then(action => {
        // create eventAction
        if (objectId != undefined && type != "createVenue") {
            var ref = `/eventActions/` + objectId
            // when initializing a dict, use [var] notation. otherwise use params[var] = val
            var params = { [actionId] : true}
            console.log("Creating eventAction for event " + objectId + " and action " + actionId + " with params " + JSON.stringify(params))
            return admin.database().ref(ref).update(params).then(() => {
                return exports.createFeedItemForEventAction(type, userId, actionId, message, defaultMessage)
            })
        } else {
            return actionId
        }
    }).then(() => {
        return actionId
    })
}

exports.postChat = function(req, res, exports, admin) {
    let userId = req.body.userId
    let eventId = req.body.eventId
    let message = req.body.message

    let type = globals.ActionType.chat

    // this triggers side effects in createAction: createFeedItemForEventAction
    // this also triggers side effects in onActionChange: adding player name, createdAt, and pushForChatAction
    return exports.createAction(type, userId, eventId, message, undefined, exports, admin).then((result) => {
        console.log("Action 1.0: postChat: created action with id " + result + " from userId " + userId + " message " + message)
        res.status(200).json({"actionId": result})
    })
}

exports.onActionChange = function(snapshot, context, exports, admin) {
    const actionId = context.params.actionId
    var changed = false
    var created = false
    var deleted = false
    var data = snapshot.after.val()
    var old = snapshot.before
    if (data == undefined) {
        // action was deleted; do nothing
        return snapshot
    }

    const actionType = data["type"]
    var eventId = data["eventId"]
    if (eventId == undefined) {
        eventId = data["event"] // backwards compatibility to support event
    }
    var userId = data["userId"]
    if (userId == undefined) {
        userId = data["user"] // backwards compatibility to support user
    }

    if (!old.exists()) {
        created = true
    } else if (old.val()["active"] == true && data["active"] == false) {
        deleted = true
        console.log("Action 1.0: onActionChange: deleted action " + actionId)
    }

    if (!created && !deleted) {
        changed = true;
    }

    if (actionType == "chat" && created == true) {
    // for a chat action, update createdAt, username then create a duplicate
        const createdAt = exports.secondsSince1970()
        return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
            return snapshot.val();
        }).then(player => { 
            // add player username and createdAt
            var ref = `/actions/` + actionId
            var name = player["name"]
            return admin.database().ref(ref).update({"createdAt": createdAt, "username": name})
        }).then(result => {
            // create eventAction
            var ref = `/eventActions/` + eventId
            // when initializing a dict, use [var] notation. otherwise use params[var] = val
            var params = { [actionId] : true}
            return admin.database().ref(ref).update(params)
        }).then(result => {
            // send push
            exports.pushForChatAction(actionId, eventId, userId, data)
            return result
        }).catch(err => {
            console.error("Action 1.0: onActionChange: error " + err.message + " action " + JSON.stringify(data))
            return snapshot
        })
    } else {
        return snapshot
    }
}

exports.pushForChatAction = function(actionId, eventId, userId, data, exports, admin) {
    var eventTopic = "event" + eventId
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        return snapshot.val();
    }).then(player => {
        var name = player["name"]
        var email = player["email"]
        var message = data["message"]
        var msg = name + " said: " + message
        var title = "Event chat"
        var topic = "event" + eventId 
        console.log("Action 1.0: pushForChatAction for chat by user " + name + " " + email + " topic: " + topic + " message: " + msg)
        let info = {"type": data.type, "eventId": eventId}
        return exports.sendPushToTopic(title, topic, msg, info)
    })
}
