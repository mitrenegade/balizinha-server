const admin = require('firebase-admin');

/*
 * userId: String
 * pushEnabled: Bool
 * returns: {success: true, subscribed: Int, unsubscribed: Int}
 * Will return a count of subscribed channels or unsubscribed channels
 * will also return an error message if failure
 */
exports.updateUserNotificationsEnabled = function(req, res, exports) {
    let userId = req.body.userId
    if (userId == undefined) {
        return res.status(500).json({"error": "User id was not specified"})
    }
    var pushEnabled = req.body.pushEnabled
    if (pushEnabled == undefined) {
        pushEnabled = true
    }
    return admin.database().ref(`/players/${userId}`).once('value').then(snapshot => {
    	if (!snapshot.exists()) {
            throw new Error("Push 1.1: UpdateUserNotificationsEnabled: No player, cannot subscribe or unsubscribe")
            return
    	}
    	// toggle all notifications first
    	let player = snapshot.val()
    	let token = player.fcmToken
    	return exports.refreshPlayerSubscriptionsHelper(userId, token, pushEnabled)
    }).then((result) => {
    	// update player object
        subscribeCounts = result
        console.log("Push 1.1: UpdateUserNotificationsEnabled: updating notificationsEnabled to " + pushEnabled)
        return admin.database().ref(`/players/${userId}`).update("notificationsEnabled": pushEnabled)
        .then(() => {
            const subscribed = result.subscribed
            const unsubscribed = result.unsubscribed
            console.log("Push 1.1: UpdateUserNotificationsEnabled: subscribed " + subscribed + " unsubscribed " + unsubscribed)
            return res.status(200).json({"success": true, "subscribed": subscribed, "unsubscribed": unsubscribed})
        })
    }).catch(err => {
        console.log("Push 1.1: UpdateUserNotificationsEnabled error: " + JSON.stringify(err));
        return res.status(500).json({"error": err.message})
    })
}

// Send Push with body
exports.sendPushToTopic = function(title, topic, body, info) {
    var topicString = "/topics/" + topic
    // topicString = topicString.replace(/-/g , '_');
    console.log("Push v1.1: send push to topic " + topicString + " title: " + title + " body: " + body + " info " + JSON.stringify(info))

    var notification = {
        title: title,
        body: body,
        sound: 'default',
        badge: '1'
    }

    // message format: { notification: notification, data: data }
    // for some reason, using admin.messaging().send(message) triggers "FCM has not been configured"
    var message = {
        notification: notification
    };
    if (info != undefined) {
        message.data = info
    }

    // Send a message to devices subscribed to the provided topic.
    return admin.messaging().sendToTopic(topicString, message)
}
