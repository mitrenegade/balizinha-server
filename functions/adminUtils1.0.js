/*
 updateEventLeagueIsPrivate
 - fixes various missing parameters such as leagueIsPrivate
*/
exports.updateEventLeagueIsPrivate = function(req, res, exports, admin) {
    // find all leagues' private status
    var leagueIsPrivate = {}
    admin.database().ref(`/leagues`).once('value').then(snapshot => {
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
            const leagueId = child.val().league
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

//exports.recountLeagueStats = function(req, res, exports, admin) {
    // delete playerCount and eventCount to force a recount for all leagues
//}