const admin = require('firebase-admin');
// actions
exports.createAction = function(type, userId, eventId, message, defaultMessage, exports, admin) {
    console.log("createAction type: " + type + " event id: " + eventId + " message: " + message)
    // NOTE: ref url is actions. iOS < v0.7.1 uses /action
    // This is called for event actions such as joinEvent, leaveEvent, createEvent
    // - does not include chats which are created through an action service call

    var actionId = exports.createUniqueId()

    var params = {}
    params["type"] = type
    params["eventId"] = eventId // slowly transitioning to use eventId
    params["userId"] = userId // slowly transitioning to use userId
    params["message"] = message
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    if (defaultMessage != undefined) {
        params["defaultMessage"] = defaultMessage
    }

    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            let player = snapshot.val()
            var name = player["name"]
            if (name == undefined) {
                name = player["email"] // allows players without a username to work
            }
            params["username"] = name
        }
        var ref = `/actions/` + actionId
        console.log("Creating action in /actions with unique id " + actionId + " message: " + message + " params: " + JSON.stringify(params))
        return admin.database().ref(ref).set(params)
    }).then(action => {
        // create eventAction
        if (eventId != undefined) {
            var ref = `/eventActions/` + eventId
            // when initializing a dict, use [var] notation. otherwise use params[var] = val
            var params = { [actionId] : true}
            console.log("Creating eventAction for event " + eventId + " and action " + actionId + " with params " + JSON.stringify(params))
            return admin.database().ref(ref).update(params).then(() => {
                return exports.createFeedItemForEventAction(type, userId, actionId, message, defaultMessage)
            })
        }
    }).then(() => {
        return actionId
    })
}

exports.postChat = function(req, res, exports, admin) {
    let userId = req.body.userId
    let eventId = req.body.eventId
    let message = req.body.message

    let type = "chat"

    // this triggers side effects in createAction: createFeedItemForEventAction
    // this also triggers side effects in onActionChange: adding player name, createdAt, and pushForChatAction
    return exports.createAction(type, userId, eventId, message, undefined, exports, admin).then((result) => {
        console.log("postChat: created action with id " + result)
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

    if (!old.exists()) {
        created = true
        console.log("onActionChange: created action " + actionId)
    } else if (old["active"] == true && data["active"] == false) {
        deleted = true
        console.log("onActionChange: deleted action " + actionId)
    }

    if (!created && !deleted) {
        changed = true;
        console.log("onActionChange: changed action " + actionId)
    }

    const actionType = data["type"]
    if (actionType == "chat" && created == true) {
    // for a chat action, update createdAt, username then create a duplicate
        const createdAt = exports.secondsSince1970()
        const userId = data["user"]
        const eventId = data["event"]
        return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
            return snapshot.val();
        }).then(player => { 
            // add player username and createdAt
            var ref = `/actions/` + actionId
            var name = player["name"]
            console.log("Action: adding createdAt " + createdAt)
            return admin.database().ref(ref).update({"createdAt": createdAt, "username": name})
        }).then(result => {
            // create eventAction
            var eventId = data["event"]
            var ref = `/eventActions/` + eventId
            // when initializing a dict, use [var] notation. otherwise use params[var] = val
            var params = { [actionId] : true}
            console.log("Creating eventAction for event " + eventId + " and action " + actionId + " with params " + JSON.stringify(params))
            return admin.database().ref(ref).update(params)
        }).then(result => {
            // send push
            console.log("onActionChange: pushForChatAction with result " + JSON.stringify(result))
            exports.pushForChatAction(actionId, eventId, userId, data)
            return result
        })
    } else {
        return snapshot
    }
}

exports.pushForChatAction = function(actionId, eventId, userId, data, exports, admin) {
    console.log("push for chat: " + actionId + " event: " + eventId + " user: " + userId + " data: " + JSON.stringify(data))

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
        console.log("Sending push for chat by user " + name + " " + email + " for chat to topic " + topic + " with message: " + msg)
        let info = {"type": data.type, "eventId": eventId}
        return exports.sendPushToTopic(title, topic, msg, info)
    })
}
