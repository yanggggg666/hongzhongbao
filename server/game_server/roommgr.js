var db = require('../utils/db');

var rooms = {};
var creatingRooms = {};

var userLocation = {};
var totalRooms = 0;

var DI_FEN = [1,2,5];
var MAX_FAN = [3,4,5];
var JU_SHU = [4,8];
var JU_SHU_COST = [2,3];

function generateRoomId(){
	var roomId = "";
	for(var i = 0; i < 6; ++i){
		roomId += Math.floor(Math.random()*10);
	}
	return roomId;
}

function constructRoomFromDb(dbdata){
	var roomInfo = {
		uuid:dbdata.uuid,
		id:dbdata.id,
		numOfGames:dbdata.num_of_turns,
		createTime:dbdata.create_time,
		nextButton:dbdata.next_button,
		seats:new Array(4),
		conf:JSON.parse(dbdata.base_info)
	};


	if(roomInfo.conf.type == "xlch"){
		roomInfo.gameMgr = require("./gamemgr_xlch");
	}
	else if(roomInfo.conf.type == "hzmj"){
		roomInfo.gameMgr = require("./gamemgr_hzmj");
	}
	else{
		roomInfo.gameMgr = require("./gamemgr_xzdd");
	}
	var roomId = roomInfo.id;

	for(var i = 0; i < 4; ++i){
		var s = roomInfo.seats[i] = {};
		s.userId = dbdata["user_id" + i];
		s.score = dbdata["user_score" + i];
		s.name = dbdata["user_name" + i];
		s.ready = false;
		s.seatIndex = i;
		s.numZiMo = 0;
		s.numJiePao = 0;
		s.numDianPao = 0;
		s.numAnGang = 0;
		s.numMingGang = 0;
		s.numChaJiao = 0;

		if(s.userId > 0){
			userLocation[s.userId] = {
				roomId:roomId,
				seatIndex:i
			};
		}
	}
	rooms[roomId] = roomInfo;
	totalRooms++;
	return roomInfo;
}

//创建红中麻将房间（癞子玩法，规则可配置）
function createHzmjRoom(creator,roomConf,ip,port,callback){
	var fnCreate = function(){
		var roomId = generateRoomId();
		if(rooms[roomId] != null || creatingRooms[roomId] != null){
			fnCreate();
		}
		else{
			creatingRooms[roomId] = true;
			db.is_room_exist(roomId, function(ret) {
				if(ret){
					delete creatingRooms[roomId];
					fnCreate();
					return;
				}
				var createTime = Math.ceil(Date.now()/1000);
				var roomInfo = {
					uuid:"",
					id:roomId,
					numOfGames:0,
					createTime:createTime,
					nextButton:0,
					seats:[],
					conf:{
						type:"hzmj",
						baseScore:DI_FEN[roomConf.difen] || 1,
						maxGames:roomConf.maxGames || JU_SHU[roomConf.jushuxuanze] || 8,
						maxFan:roomConf.zuidafanshu != null ? MAX_FAN[roomConf.zuidafanshu] : 5,
						//规则选项（缺省见 gamemgr_hzmj.applyConfDefaults）
						canJiePao:roomConf.canJiePao !== false,
						qiangGang:roomConf.qiangGang !== false,
						laiziChu:roomConf.laiziChu === true,
						fanPerLaizi:roomConf.fanPerLaizi || 0,
						zimoFan:roomConf.zimoFan != null ? roomConf.zimoFan : 1,
						pphFan:roomConf.pphFan != null ? roomConf.pphFan : 2,
						qdFan:roomConf.qdFan != null ? roomConf.qdFan : 2,
						qysFan:roomConf.qysFan != null ? roomConf.qysFan : 3,
						gangScore:roomConf.gangScore != null ? roomConf.gangScore : 1,
						actionTimeout:roomConf.actionTimeout != null ? roomConf.actionTimeout : 15,
						//机器人数量（0-3，缺人凑桌）
						robots:roomConf.robots || 0,
						creator:creator,
					}
				};
				roomInfo.gameMgr = require("./gamemgr_hzmj");
				console.log(roomInfo.conf);

				for(var i = 0; i < 4; ++i){
					roomInfo.seats.push({
						userId:0, score:0, name:"", ready:false, seatIndex:i,
						numZiMo:0, numJiePao:0, numDianPao:0,
						numAnGang:0, numMingGang:0, numChaJiao:0,
					});
				}

				db.create_room(roomInfo.id,roomInfo.conf,ip,port,createTime,function(uuid){
					delete creatingRooms[roomId];
					if(uuid != null){
						roomInfo.uuid = uuid;
						rooms[roomId] = roomInfo;
						totalRooms++;
						callback(0,roomId);
					}
					else{
						callback(3,null);
					}
				});
			});
		}
	};
	fnCreate();
}

exports.createRoom = function(creator,roomConf,gems,ip,port,callback){
	//红中麻将：独立的配置校验（规则可配置，缺省自动补全）
	if(roomConf.type == "hzmj"){
		if(roomConf.jushuxuanze == null || roomConf.difen == null){
			callback(1,null);
			return;
		}
		if(roomConf.jushuxuanze < 0 || roomConf.jushuxuanze > JU_SHU.length){
			callback(1,null);
			return;
		}
		var hzmjCost = JU_SHU_COST[roomConf.jushuxuanze];
		if(hzmjCost > gems){
			callback(2222,null);
			return;
		}
		return createHzmjRoom(creator,roomConf,ip,port,callback);
	}

	if(
		roomConf.type == null
		|| roomConf.difen == null
		|| roomConf.zimo == null
		|| roomConf.jiangdui == null
		|| roomConf.huansanzhang == null
		|| roomConf.zuidafanshu == null
		|| roomConf.jushuxuanze == null
		|| roomConf.dianganghua == null
		|| roomConf.menqing == null
		|| roomConf.tiandihu == null){
		callback(1,null);
		return;
	}

	if(roomConf.difen < 0 || roomConf.difen > DI_FEN.length){
		callback(1,null);
		return;
	}

	if(roomConf.zimo < 0 || roomConf.zimo > 2){
		callback(1,null);
		return;
	}

	if(roomConf.zuidafanshu < 0 || roomConf.zuidafanshu > MAX_FAN.length){
		callback(1,null);
		return;
	}

	if(roomConf.jushuxuanze < 0 || roomConf.jushuxuanze > JU_SHU.length){
		callback(1,null);
		return;
	}
	
	var cost = JU_SHU_COST[roomConf.jushuxuanze];
	if(cost > gems){
		callback(2222,null);
		return;
	}

	var fnCreate = function(){
		var roomId = generateRoomId();
		if(rooms[roomId] != null || creatingRooms[roomId] != null){
			fnCreate();
		}
		else{
			creatingRooms[roomId] = true;
			db.is_room_exist(roomId, function(ret) {

				if(ret){
					delete creatingRooms[roomId];
					fnCreate();
				}
				else{
					var createTime = Math.ceil(Date.now()/1000);
					var roomInfo = {
						uuid:"",
						id:roomId,
						numOfGames:0,
						createTime:createTime,
						nextButton:0,
						seats:[],
						conf:{
							type:roomConf.type,
							baseScore:DI_FEN[roomConf.difen],
						    zimo:roomConf.zimo,
						    jiangdui:roomConf.jiangdui,
						    hsz:roomConf.huansanzhang,
						    dianganghua:parseInt(roomConf.dianganghua),
						    menqing:roomConf.menqing,
						    tiandihu:roomConf.tiandihu,
						    maxFan:MAX_FAN[roomConf.zuidafanshu],
						    maxGames:JU_SHU[roomConf.jushuxuanze],
						    creator:creator,
						}
					};
					
					if(roomConf.type == "xlch"){
						roomInfo.gameMgr = require("./gamemgr_xlch");
					}
					else{
						roomInfo.gameMgr = require("./gamemgr_xzdd");
					}
					console.log(roomInfo.conf);
					
					for(var i = 0; i < 4; ++i){
						roomInfo.seats.push({
							userId:0,
							score:0,
							name:"",
							ready:false,
							seatIndex:i,
							numZiMo:0,
							numJiePao:0,
							numDianPao:0,
							numAnGang:0,
							numMingGang:0,
							numChaJiao:0,
						});
					}
					

					//写入数据库
					var conf = roomInfo.conf;
					db.create_room(roomInfo.id,roomInfo.conf,ip,port,createTime,function(uuid){
						delete creatingRooms[roomId];
						if(uuid != null){
							roomInfo.uuid = uuid;
							console.log(uuid);
							rooms[roomId] = roomInfo;
							totalRooms++;
							callback(0,roomId);
						}
						else{
							callback(3,null);
						}
					});
				}
			});
		}
	}

	fnCreate();
};

exports.destroy = function(roomId){
	var roomInfo = rooms[roomId];
	if(roomInfo == null){
		return;
	}

	for(var i = 0; i < 4; ++i){
		var userId = roomInfo.seats[i].userId;
		if(userId != 0){
			delete userLocation[userId];
		}
		if(userId > 0){
			db.set_room_id_of_user(userId,null);
		}
	}

	//清理房间内机器人（延迟 require 避免循环依赖）
	try{
		require('./botmgr').removeBotsInRoom(roomId);
	}
	catch(e){}

	delete rooms[roomId];
	totalRooms--;
	db.delete_room(roomId);
}

exports.getTotalRooms = function(){
	return totalRooms;
}

exports.getRoom = function(roomId){
	return rooms[roomId];
};

exports.isCreator = function(roomId,userId){
	var roomInfo = rooms[roomId];
	if(roomInfo == null){
		return false;
	}
	return roomInfo.conf.creator == userId;
};

exports.enterRoom = function(roomId,userId,userName,callback){
	var fnTakeSeat = function(room){
		if(exports.getUserRoom(userId) == roomId){
			//已存在
			return 0;
		}

		for(var i = 0; i < 4; ++i){
			var seat = room.seats[i];
			//userId === 0 才是空位（负数 userId 为机器人，不能被覆盖）
			if(seat.userId === 0){
				seat.userId = userId;
				seat.name = userName;
				userLocation[userId] = {
					roomId:roomId,
					seatIndex:i
				};
				//console.log(userLocation[userId]);
				db.update_seat_info(roomId,i,seat.userId,"",seat.name);
				//正常
				return 0;
			}
		}	
		//房间已满
		return 1;	
	}
	var room = rooms[roomId];
	if(room){
		var ret = fnTakeSeat(room);
		callback(ret);
	}
	else{
		db.get_room_data(roomId,function(dbdata){
			if(dbdata == null){
				//找不到房间
				callback(2);
			}
			else{
				//construct room.
				room = constructRoomFromDb(dbdata);
				//
				var ret = fnTakeSeat(room);
				callback(ret);
			}
		});
	}
};

exports.setReady = function(userId,value){
	var roomId = exports.getUserRoom(userId);
	if(roomId == null){
		return;
	}

	var room = exports.getRoom(roomId);
	if(room == null){
		return;
	}

	var seatIndex = exports.getUserSeat(userId);
	if(seatIndex == null){
		return;
	}

	var s = room.seats[seatIndex];
	s.ready = value;
}

exports.isReady = function(userId){
	var roomId = exports.getUserRoom(userId);
	if(roomId == null){
		return;
	}

	var room = exports.getRoom(roomId);
	if(room == null){
		return;
	}

	var seatIndex = exports.getUserSeat(userId);
	if(seatIndex == null){
		return;
	}

	var s = room.seats[seatIndex];
	return s.ready;	
}


exports.getUserRoom = function(userId){
	var location = userLocation[userId];
	if(location != null){
		return location.roomId;
	}
	return null;
};

exports.getUserSeat = function(userId){
	var location = userLocation[userId];
	//console.log(userLocation[userId]);
	if(location != null){
		return location.seatIndex;
	}
	return null;
};

exports.getUserLocations = function(){
	return userLocation;
};

exports.exitRoom = function(userId){
	var location = userLocation[userId];
	if(location == null)
		return;

	var roomId = location.roomId;
	var seatIndex = location.seatIndex;
	var room = rooms[roomId];
	delete userLocation[userId];
	if(room == null || seatIndex == null) {
		return;
	}

	var seat = room.seats[seatIndex];
	seat.userId = 0;
	seat.name = "";

	var numOfPlayers = 0;
	for(var i = 0; i < room.seats.length; ++i){
		if(room.seats[i].userId > 0){
			numOfPlayers++;
		}
	}
	
	db.set_room_id_of_user(userId,null);

	if(numOfPlayers == 0){
		exports.destroy(roomId);
	}
};