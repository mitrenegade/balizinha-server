var rp = require('request-promise-native')

// dynamic links https://firebasedynamiclinks.googleapis.com/v1/shortLinks?key=a
// https://github.com/request/request-promise-native
// https://www.npmjs.com/package/request-promise
// payload format: https://firebase.google.com/docs/reference/dynamic-links/link-shortener
// use dynamicLinkDomain instead https://stackoverflow.com/questions/51308933/firebase-dynamic-link-internal-error-when-creating-using-curl
exports.createDynamicLink = function(exports, admin, type, id, socialMetaTagInfo) {
    const apiKey = exports.getAPIKey()
    const url = "https://firebasedynamiclinks.googleapis.com/v1/shortLinks?key=" + apiKey
    var domain
    if (exports.isDev()) {
        domain = "pannadev.page.link"
    } else {
        domain = "pannaleagues.page.link"
    }
    const link = "https://pannaleagues.com/?type=" + type + "&id=" + id
    const iosBundleId = "io.renderapps.balizinha"
    const iosAppStoreId = "1198807198"
    const androidPackageName = "io.renderapps.balizinha"
    var dynamicLinkInfo = {
        "dynamicLinkDomain": domain,
        "link": link,
        "androidInfo": {
            "androidPackageName": androidPackageName
        },
        "iosInfo": {
            "iosBundleId": iosBundleId,
            "iosAppStoreId": iosAppStoreId
        }
    }
    if (socialMetaTagInfo != undefined) {
        dynamicLinkInfo["socialMetaTagInfo"] = socialMetaTagInfo
    }
    var payload = {
        "dynamicLinkInfo": dynamicLinkInfo,
        "suffix": {
            "option": "SHORT"
        }
    }
    console.log("createDynamicLink: domain " + domain + " payload " + JSON.stringify(payload) + " url " + url)
    var options = {
        method: 'POST',
        uri: url,
        body: payload,
        json: true // Automatically stringifies the body to JSON
    };
    return rp(options).then(function(results){
        console.log("Dynamic link created: " + JSON.stringify(results))
        if (results.shortLink != undefined) {
            const shortLink = results.shortLink
            // write shared link to relevant objects
            if (type == "events" || type == "leagues") {
                return admin.database().ref(`/${type}/${id}`).update({"shareLink": shortLink}).then(results => {
                    console.log("Short link " + shortLink + " for " + type + " " + id)
                    return new Promise(function(resolve, reject) {
                        resolve(shortLink)
                    })
                })
            } else {
                console.log("why are we here 2 " + type)
            }
        } else {
            console.log("why are we here 1 " + results.shortLink)
        }
    }).catch(function(err) {
        console.log("Dynamic link creation failed: " + JSON.stringify(err))
        return err
    })
}
