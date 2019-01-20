"use strict";
const xmlbuilder = require('xmlbuilder');
const url = require('url');
const http = require('http');

var createRequest = function(queryString, startingIndex, requestedCount) {
    var searchCriteria =  '(upnp:class derivedfrom "object.item.audioItem")';
    var filter = '(upnp:artist contains "'+queryString+'")';
    var sort ='';//'+upnp:artist';


    var xmlStr=xmlbuilder.create('s:Envelope', { version: '1.0', encoding: 'utf-8' })
        .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
        .att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
        .ele('s:Body')
        .ele('u:Search', {  'xmlns:u': 'urn:schemas-upnp-org:service:ContentDirectory:1'})
        .ele('ContainerID', '0')
        .up().ele('SearchCriteria', searchCriteria)
        .up().ele('Filter', filter)
        .up().ele('StartingIndex', startingIndex)
        .up().ele('RequestedCount', requestedCount)
        .up().ele('SortCriteria',  sort )
        .doc().end({ pretty: false, indent: '', allowEmpty: true });
    console.log(xmlStr)

    return xmlStr;
}

var searchBrowser = function(controlUrl, queryString) {
    var limit = 100;

    var serverUrl=controlUrl.split('@')[0];
    console.log("SERVER URL "+serverUrl)
    const requestUrl = url.parse(serverUrl);
    var requestXml = createRequest(queryString,0,limit);


    const httpOptions =  {
        protocol: "http:",
        host: requestUrl.hostname,
        port: requestUrl.port,
        path: requestUrl.path,
        method: 'POST',
        headers: { 'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Search"',
            "Content-Length": Buffer.byteLength(requestXml, 'utf8'),
            "Content-Type": "text/xml charset='utf-8'",
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