"use strict";
const xmlbuilder = require('xmlbuilder');
const url = require('url');
const http = require('http');

var createRequest = function(containerID, startingIndex, requestedCount) {
    var searchCriteria ="";
    var filter = "";
    var sort ="";

    return xmlbuilder.create('s:Envelope', { version: '1.0', encoding: 'utf-8' })
        .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
        .att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
        .ele('s:Body')
        .ele('u:Search', { 'xmlns:u': 'urn:schemas-upnp-org:service:ContentDirectory:1'})
        .ele('ContainerID', containerID)
        .up().ele('SearchCriteria', searchCriteria)
        .up().ele('Filter', filter)
        .up().ele('StartingIndex', startingIndex)
        .up().ele('RequestedCount', requestedCount)
        .up().ele('SortCriteria', sort)
        .doc().end({ pretty: false, indent: '', allowEmpty: true });
}

var searchBrowser = function(controlUrl, id) {
    var limit = 100;

    var serverUrl=controlUrl.split('@')[0];
    console.log("SERVER URL "+serverUrl)
    const requestUrl = url.parse(serverUrl);
    var requestXml = createRequest(id,0,limit);


    const httpOptions =  {
        protocol: "http:",
        host: requestUrl.hostname,
        port: requestUrl.port,
        path: requestUrl.path,
        method: 'POST',
        headers: { 'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Search"',
            "Content-Length": Buffer.byteLength(requestXml, 'utf8'),
            "Content-Type": "text/xml",
            "User-Agent": "Volumio UPnP/1.0 DLNADOC/1.50"}
    }

    const req = http.request(httpOptions, function(response) {
        var data = '';
        response.on('data', function(newData) {
            data = data + newData;
        });

        /*response.on('err', function(err) {
            log(callback(err));
        });*/

        response.on('end', function() {
            console.log("SEARCH RESULT: " + data);
        });

    });
    req.on('error', function(err) {
        //callback(err);
        req.abort();
    });
    req.write(requestXml);
    req.end();

}

module.exports.searchBrowser=searchBrowser;