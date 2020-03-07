const admin = require('firebase-admin');
const globals = require('./globals')

exports.createLeague = function(req, res, exports, admin) {
	// Use database to declare databaseRefs:
	const name = req.body.name
	const city = req.body.city
	const info = req.body.info
	const userId = req.body.userId // userId of the one who created, becomes an owner

	const leagueId = exports.createUniqueId()
    var ref = `/leagues/` + leagueId
    var params = {"name": name, "city": city, "info": info}
    var createdAt = exports.secondsSince1970()
    params["createdAt"] = createdAt
    // TODO: name validation?
    console.log("Creating league in /leagues with unique id " + leagueId + " name: " + name + " city: " + city)
    return admin.database().ref(ref).set(params).then(() => {
    	console.log("creating league " + leagueId + " complete. calling joinLeague for player " + userId)
    	const status = "organizer"
    	return exports.doUpdatePlayerStatus(admin, userId, leagueId, status)
    }).then(result => {
    	console.log("joinLeague result " + JSON.stringify(result) + ". Adding ownership league")
    	let ownersRef = `/leagueOwners/${leagueId}`
    	let params = {[userId]: true}
	    return admin.database().ref(ownersRef).update(params)
	}).then(result => {
    	// can't return league as a snapshot. only return the id
	    res.send(200, {'league': leagueId})
    }).catch(err => {
    	res.send(500, {'error': err.message})
    })
}