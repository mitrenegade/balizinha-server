/*
 UpdateEventParameters
 - fixes various missing parameters such as leagueIsPrivate
*/
exports.updateEventParameters = function(req, res, exports, admin) {
    // find all leagues' private status
    var leagueIsPrivate = [:]
    admin.database().ref(`/leagues`).once('value').then(snapshot => {
        snapshot.forEach(child => {
            const leagueId = child.key
            const league = child.val()
            console.log("League: " + JSON.stringify(league) + " private " + league.isPrivate)
            if league.isPrivate == true {
                leagueIsPrivate[leagueId] = true
            } else {
                leagueIsPrivate[leagueId] = false
            }
        })
        return admin.database().ref(`/events`).once('value')
    }).then(snapshot => {
        snapshot.forEach(child => {
            const eventId = child.key
            const event = child.val()
            const leagueId = event.league
            const isPrivate = leagueIsPrivate[leagueId]
            console.log("Event: " + event.id + " league " + leagueId + " old leagueIsPrivate: " + event.leagueIsPrivate + " new: " + isPrivate)
            var params = ["leagueIsPrivate": isPrivate]
            return admin.database().ref(`/events/${eventId}`).update(params)
        })
    })
}
