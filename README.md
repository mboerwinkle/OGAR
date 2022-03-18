# OGAR
Open Gallery for Arts Research

## Interested in setting up your own study?
Open an issue, or send us an email at martin@boerwi.net or rmrodriguez@uncg.edu. We look forward to helping you out!

## Server
### Intro
This is the OGAR Server. It collects user interaction data over websocket.

### Prerequisites
- You must have a Linux server to deploy on. (We recommend spinning up a t2.micro on AWS. High load? Contact us.) It must:
  * Be routable from the internet
  * Have a trusted SSL certificate/key pair (GoDaddy + LetsEncrypt are the easiest way to do this.)
  * Be fully patched
  * Have systemd (if you want to use the .service configuration)
  * Have Python3, and the Websockets library for Python3
- You must:
  * Be competent and comfortable running a little-known and unaudited Python program on your server. If something goes wrong, you want your server to have limited resources and no access to your domain.

### Setup
#### Configure the .service and .py files
Change `WorkingDirectory`, `ExecStart`, `StandardOutput`, and `StandardError` to suit your preferences.

`example.com` in `ExecStart` represents the CN of the certificate you are using. `galleryReceptor.py` does its best to find your certificate/key pair based on the supplied domain name, but if you have difficulty, you might consider hard-coding it instead (by changing the `certfile` and `keyfile` arguments to `ssl_context.load_cert_chain()`).

#### Configure your firewall
The OGAR Server listens on TCP 6411.

## Client
### Intro
The OGAR Client. This help page describes a deployment to a Qualtrics survey, but you can deploy it to most survey providers that allow custom JavaScript.

### Prerequisites
You must:
- Have a Qualtrics account which supports setting custom JavaScript on questions. Only paid/enterprise/education accounts allow this at time of writing.
- Have your gallery resources hosted somewhere (it can be on the same server, with Apache or Nginx). You will need to design a gallery floorplan and have copies of images licensed for research use. The Client/gl folder contents must also be hosted there. You can find more details about these on our [OSF Page](https://osf.io/8upvq/).

### Setup
Create a blank text question in Qualtrics. Add JavaScript to the question. Delete all of the code that comes prefilled in the JS Editor.

Copy the contents of QualtricsAuxFunctions.js into the JS Editor. Replace the line `// Put the entire contents of ogar.js here.` with the contents of ogar.js.

Change the line `const isQual = false;` to set to true. This configures the client to interact with the Qualtrics API.

Change `GalleryOpts.ReceptorAddr` to point to the OGAR Server you have created.

Change `GalleryOpts.GalleryDataRoot` to point to the location where your gallery resources are hosted.

Try to use the gallery. Use the web console to troubleshoot any problems you run into, or send us an email.

### Notes
Your study should prevent participants from accessing the gallery via mobile devices or with Safari.
