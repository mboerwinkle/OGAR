import asyncio
import json
import websockets
import queue
import threading
import time
import ssl
import sqlite3
import sys

if len(sys.argv) < 2:
	sys.exit("You must specify your domain name as an argument")
domainname = sys.argv[1]
certPathPrefix = "/etc/letsencrypt/live/{:s}/".format(domainname)


CLIENTS = []
CLIENTCOUNT = 0
RES = None

class ResourceWrapper:
	def __init__(self, dbfilepath):
		print("Loading resource db \""+dbfilepath+"\"")
		try:
			self.dbconn = sqlite3.connect(dbfilepath)
		except:
			print("Failed to connect to database")
		self.regenCursor()
		self.c.execute("PRAGMA foreign_keys = ON;")
	def regenCursor(self):
		self.c = self.dbconn.cursor()
	def tablesize(self, table):
		self.c.execute("select count(1) from "+table+";")
		return self.c.fetchone()[0]
	def exists(self, table, field, value):
		self.c.execute("select count(1) from "+table+" where "+field+" = ?;", (value,));
		return self.c.fetchone()[0] != 0
	def commit(self):
		self.dbconn.commit()


class Client:
	def __init__(self, websocket):
		self.ws = websocket
		self.id = None#id
		self.qid = None#qualtrics id
	def send(self, msg):
		asyncio.run(self.ws.send(msg))

async def register(websocket):
	print("client got ", websocket.remote_address)
	c = Client(websocket)
	CLIENTS.append(c)
	return c

async def unregister(websocket):
	for c in CLIENTS:
		if(c.ws == websocket):
			CLIENTS.remove(c)
			return
#asynchronous client commands that need to be processed later
CLIENTCOMMANDS = queue.Queue(maxsize=1000)

def pushToClientQueue(comm):
	global CLIENTCOMMANDS
	try:
		CLIENTCOMMANDS.put_nowait(comm)
	except queue.Full:
		print("Failed to append to clientcommands. Queue full.")

def popFromClientQueue():
	global CLIENTCOMMANDS
	return CLIENTCOMMANDS.get()

async def clienthandler(websocket, path):
	global CLIENTS, CLIENTCOUNT
	client = await register(websocket)
	pushToClientQueue((client, "connect"))
	CLIENTCOUNT += 1
	try:
		async for message in websocket:
			data = json.loads(message)
			if data["type"] == "reg":#register
				print("Player joining: "+data["qid"]+" "+str(client.ws.remote_address))
				pushToClientQueue((client, "reg", data["qid"]))
			elif data["type"] in ("err", "evt", "pos", "perf"):
				pushToClientQueue((client, data["type"], data))
			else:
				print("Unknown type: "+data["type"])
	except Exception:
		print("Client handler excepted:",Exception)
	finally:
		pushToClientQueue((client, "disconnect"))
		await unregister(websocket)
		CLIENTCOUNT -= 1
		print("Client Disconn (",CLIENTCOUNT," left)")

def MainLoop():
	global RES
	RES = ResourceWrapper('ogarserver.sqlite3')
	RES.c.executescript('''
	CREATE TABLE IF NOT EXISTS participant (
		id int,
		qid varchar(50),
		conntime int,
		disconntime int,
		ip varchar(16),
		primary key(id)
	);
	CREATE TABLE IF NOT EXISTS event (
		id int,
		timestamp int,
		eventid int,
		foreign key(id) references participant
	);
	CREATE TABLE IF NOT EXISTS perf (
		id int,
		timestamp int,
		drawfps int,
                iterfps int,
                drawtime real,
                itertime real,
		foreign key(id) references participant
	);
	CREATE TABLE IF NOT EXISTS position (
		id int,
		timestamp int,
		millisecond int,
		locX real,
		locY real,
		yaw real,
		pitch real,
		foreign key(id) references participant
	);
	CREATE TABLE IF NOT EXISTS error (
		id int,
		timestamp int,
		msg varchar(200),
		foreign key (id) references participant
	);
	PRAGMA foreign_keys=ON;
	''')
	retmaxpart = RES.c.execute("select max(id) from participant").fetchone()
	nextUID = 0
	if retmaxpart[0] != None:
		nextUID = retmaxpart[0]+1
		print("Starting from uid:",nextUID)
	else:
		print("Starting from empty database.")
	posQString = "insert into position (id, timestamp, millisecond, locX, locY, yaw, pitch) VALUES (?,?,?,?,?,?,?);"
	perfQString = "insert into perf (id, timestamp, drawfps, drawtime, iterfps, itertime) VALUES (?,?,?,?,?,?);"
	errQString = "insert into error (id, timestamp, msg) VALUES (?,?,?);"
	evtQString = "insert into event (id, timestamp, eventid) VALUES (?,?,?);"
	regQString = "update participant set qid = ? where id = ?;"
	connQString = "insert into participant (id, conntime, ip) values (?,strftime('%s','now'),?);"
	disconnQString = "update participant set disconntime = strftime('%s','now') where id = ?;"
	while True:
		command = popFromClientQueue()
		client = command[0]
		task = command[1]
		if task == "pos":
			d = command[2]
			RES.c.execute(posQString, (client.id, d['time'], d['milli'], d['x'], d['y'], d['yaw'], d['pitch']))
		elif task == "perf":
                        d = command[2]
                        RES.c.execute(perfQString, (client.id, d['t'], d['d'], d['dt'], d['i'], d['it']))
		elif task == "err":
			d = command[2]
			RES.c.execute(errQString, (client.id, d['time'], d['err'].strip()[0:150]))
		elif task == "evt":
			d = command[2]
			RES.c.execute(evtQString, (client.id, d['time'], d['evt']))
		elif task == "reg":
			client.qid = command[2]
			RES.c.execute(regQString, (client.qid, client.id))
		elif task == "connect":
			client.id = nextUID
			ipstring = "0.0.0.0"#do not save IP for irb compliance
			#ipstring = str(client.ws.remote_address)
			RES.c.execute(connQString, (client.id, ipstring))
			nextUID+=1
		elif task == "disconnect":
			RES.c.execute(disconnQString, (client.id,))
			RES.commit()
		else:
			print("Unknown client command: ", task)

ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ssl_context.load_cert_chain(certfile=certPathPrefix+"fullchain.pem", keyfile=certPathPrefix+"privkey.pem")
DBThread = threading.Thread(group=None, target=MainLoop, name="DBThread")
DBThread.start()
asyncio.get_event_loop().run_until_complete(websockets.serve(clienthandler, port=6411, ssl=ssl_context))#GALL
asyncio.get_event_loop().run_forever()
