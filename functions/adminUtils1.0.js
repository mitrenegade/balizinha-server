const admin = require('firebase-admin');
/*
 updateEventLeagueIsPrivate
 - fixes various missing parameters such as leagueIsPrivate
*/
exports.updateEventLeagueIsPrivate = function(req, res, exports, admin) {
    // find all leagues' private status
    var leagueIsPrivate = {}
    return admin.database().ref(`/leagues`).once('value').then(snapshot => {
        snapshot.forEach(child => {
            const leagueId = child.key
            const league = child.val()
            console.log("League: " + JSON.stringify(league) + " private " + league.isPrivate)
            if (league.isPrivate == true) {
                leagueIsPrivate[leagueId] = true
            } else {
                leagueIsPrivate[leagueId] = false
            }
        })
        return admin.database().ref(`/events`).once('value')
    }).then(snapshot => {
        if (!snapshot.exists()) {
            return res.status(500).json({"error": "events not found"})
        }
        var privateCount = 0
        var publicCount = 0
        snapshot.forEach(child => {
            const eventId = child.key
            var leagueId = child.val().league
            if (leagueId == undefined) {
                leagueId = child.val().leagueId
            }
            const isPrivate = leagueIsPrivate[leagueId]
            if (isPrivate == true) {
                privateCount = privateCount + 1
            } else {
                publicCount = publicCount + 1
            }
            if (leagueId != undefined && leagueId.length > 0) {
                console.log("Event: " + eventId + " league " + leagueId + " old leagueIsPrivate: " + child.val().leagueIsPrivate + " new: " + isPrivate)
                var params = {"leagueIsPrivate": isPrivate}
                admin.database().ref(`/events/${eventId}`).update(params)
            }
        })
        return res.status(200).json({"result": {"public": publicCount, "private": privateCount}})
    })
}

exports.recountLeagueStats = function(req, res, exports, admin) {
    // delete playerCount and eventCount to force a recount for all leagues
    return admin.database().ref(`/leagues`).once('value').then(snapshot => {
        var promises = []
        snapshot.forEach(child => {
            if (child.exists()) {
                const leagueId = child.key
                console.log("RecountLeagueStats: Resetting stats for league " + leagueId)
                var params = { "playerCount" : null, "eventCount": null }
                var promiseRef = admin.database().ref(`/leagues/${leagueId}`).update(params)
                promises.push(promiseRef)
            }
        })
        Promise.all(promises).then(result => {
            console.log("RecountLeagueStats: updated " + promises.length + " leagues" + " with result " + JSON.stringify(result))
            res.status(200).json({"result": {"count": promises.length}})
        }).catch(err => {
            console.log("RecountLeagueStats: error " + JSON.stringify(err))
            res.status(500).json({"error": err.message})
        })
    })
}

exports.cleanupAnonymousAuth = function(req, res, exports, admin) {
    // cleans up anonymous auth accounts that are created whenever a user sees signup screen
    // only delete auth that is X days old
    // https://firebase.google.com/docs/auth/admin/manage-users#delete_a_user
    // https://firebase.google.com/docs/reference/admin/node/admin.auth.Auth#listUsers
    // promise handling rejections http://adampaxton.com/handling-multiple-javascript-promises-even-if-some-fail/
    var promises = []
    return admin.auth().listUsers().then(function(listUsersResult) {
        var now = new Date();
        listUsersResult.users.forEach(function(userRecord) {
            var userDict = userRecord.toJSON()
            const uid = userDict.uid
            const timestamp = userDict.metadata.lastSignInTime // format is: Wed, 21 Mar 2018 13:18:10 GMT
            const signinDate = new Date(timestamp)
            const timediff = Math.abs(now.getTime() - signinDate.getTime())
            // console.log("User " + uid + " timestamp " + timestamp + " date " + signinDate.getTime() + "timediff " + timediff)
            // only delete anonymous users whose last login is 6 months or older
            if (timediff > 24 * 3600 * 30 * 1 * 1000) { // 6 months in milliseconds
                var promise = 
                    admin.database().ref(`/players/${uid}`).once('value').then(snapshot => {
                        if (snapshot.exists()) {
                            // make sure nothing happens 
//                            resultJSON[uid] = "exists"
                            console.log("cleanupAnonymousAuth uid: " + uid + " exists ")
                            return {[uid]: "exists"}
                        } else {
                            return admin.auth().deleteUser(uid).then(function() {
                                userDict.deleted = true
                                //resultJSON[uid] = userDict//Object.assign(resultJSON, userRecord.toJSON())
                                console.log("cleanupAnonymousAuth uid: " + uid + " deleted ")
                                return {[uid]: userDict}
                            }).catch(function(error) {
                                if (error.code == 400 && error.message == "QUOTA_EXCEEDED") {
                                    userDict.deleted = false
                                    userDict.error = JSON.stringify(error)
                                    //resultJSON[uid] = userDict//Object.assign(resultJSON, userRecord.toJSON())
                                    console.log("cleanupAnonymousAuth: received QUOTA_EXCEEDED on user " + uid)
                                    return {[uid]: userDict}
                                } else {
                                    return {[uid]: error}
                                }
                            })
                        }
                    })
                promises.push(promise)
            }
        });
        var resultJSON = {}
        Promise.all(promises).then(result => {
            result.forEach(function(dict) {
                var key = Object.keys(dict)[0]
                var val = dict[key]
                resultJSON[key] = val
            })            
            // result is an array of {uid: stuff}. this must be converted to a dictionary to be returned as a JSON
            console.log("cleanupAnonymousAuth: promises complete with result " + JSON.stringify(resultJSON))
            return res.status(200).json(resultJSON)
        })
    }).catch(function(err) {
        console.log("cleanupAnonymousAuth Error listing users:", err);
        return res.status(500).json({"error": err.message})
    });
}

deleteUser = function(uid) {
    admin.auth().deleteUser(uid).then(function() {
        return console.log("Successfully deleted user");
    }).catch(function(error) {
        return console.log("Error deleting user:", error);
    });
}

exports.generateShareLink = function(req, res, exports, admin) {
    let type = req.body.type
    let id = req.body.id
    var meta = {"socialTitle":"Panna Social Leagues"} // default meta
    let socialTitle = req.body.socialTitle
    let socialDescription = req.body.socialDescription
    let socialImageLink = req.body.socialImageLink
    if (socialTitle != undefined) {
        meta["socialTitle"] = socialTitle
    }
    if (socialDescription != undefined) {
        meta["socialDescription"] = socialDescription
    }
    if (socialImageLink != undefined) {
        meta["socialImageLink"] = socialImageLink
    }
    return exports.createDynamicLink(type, id, meta).then(result => {
        console.log("Admin: generateShareLink: for " + type + " id " + id + " result " + result)
        res.status(200).json({"shareLink": result})
    }).catch(err => {
        console.log("Admin: generateShareLink resulted in error " + err.message)
        res.status(500).json(err.message)
    })
}

exports.migrateStripeCustomers = function(req, res) {
    const oldCustomerRef = `/stripe_customers`
    const newCustomerRef = `/stripeCustomers`
    var oldCount = 0
    var newCount = 0
    return admin.database().ref(oldCustomerRef).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            throw new Error("Endpoint stripe_customers was not found")
        }
        oldCount = snapshot.numChildren()
        console.log("Admin: migrateStripeCustomers oldCount " + oldCount)
        return snapshot.val()
    }).then(customers => {
        return admin.database().ref(newCustomerRef).update(customers)
    }).then(result => {
        return admin.database().ref(newCustomerRef).once('value')
    }).then(snapshot => {
        newCount = snapshot.numChildren()
        console.log("Admin: migrateStripeCustomers results: oldCount " + oldCount + " newCount " + newCount)
        res.status(200).json({"success": true, "old": oldCount, "new": newCount})
    }).catch(err => {
        res.status(500).json({"error": err})
    })
}
