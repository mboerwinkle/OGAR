// This templates how the gallery can be embedded in Qualtrics

Qualtrics.SurveyEngine.addOnload(function()
{
 // This function remains empty
});

// These two variables allow the gallery to be cleaned-up upon proceeding in the survey
var OGARgallery;
var cust_intervals;

Qualtrics.SurveyEngine.addOnReady(function()
{
 // Put the entire contents of ogar.js here.
});


// addOnPageSubmit and addOnUnload sometimes trigger together, but sometimes only one will trigger. We want to close the websocket no matter which triggers.
// Qualtrics requests we clear our intervals in addOnUnload.
Qualtrics.SurveyEngine.addOnPageSubmit(function()
{
        console.log("submit", OGARgallery);
	// Close the websocket
        if(OGARgallery.ws.readyState < 2) OGARgallery.ws.close();
});
Qualtrics.SurveyEngine.addOnUnload(function()
{
        console.log("unload", OGARgallery);
	// Clear the intervals
        cust_intervals.forEach(i => {clearInterval(i);});
	// Close the websocket
        if(OGARgallery.ws.readyState < 2) OGARgallery.ws.close();
});

