/* global macro chilipeppr $ */
/* 

============ MACRO XTC (Automatic Tool Changer) ================================

This macro is used for an Automatic Toolchanger. This woll control the used gcode 
and try to find the Toolchnages, use the Toolnumber to identify the correct Toolholder.
This Macro remember on the used tool and find the correct strategie to let the 
actual used tool in the holder and get a new one.

This will parse the comment to get gcode from commandline i.e.:
   M6 T1
  
And then it sends commands to a Arduino+DC Spindle Controller
to pre-poition, tight or loose the ER11 Collet.

To test this with tinyg2 or tinyg follow this steps:
   * use SPJS 1.89
   * use url http://chilipeppr.com/tinyg?v9=true
   * set linenumbers on
   * in tinyg widget set "No init CMD's Mode"
   * choose "tinygg2" in SPJS Widget

*/
if (!Array.prototype.last){
    Array.prototype.last = function(){
        return this[this.length - 1];
    };
};

var myXTCMacro = {
    serialPortXTC:    "/dev/ttyUSB2", // XTC Controlelr
    atcParameters: {
      level:   800,     // the current level in mA where the spindle will break
      revlevel:-3000,   // the reverse level in mA where the spindle will break
      forward: 30,      // value for minimum rpm
      safetyHeight: 35, // safety height
      feedRate: 300,    // Feedrate to move over the catch cable
      nutZ: -7,         // safety deep position of collet in nut
    },
    atcMillHolder: [
      // Center Position holder, catch height, tighten value, how long tighten in milliseconds
      // ---------|-------------|-------------|--------------------------------
      {posX : -235, posY : 26.5,   posZ: 5,   tourque: 300, time: 500}, // first endmill holder
    ],
    feedRate: 100,
    toolnumber: 0,
    pauseline: 0,
    exeLine: 0,
	toolinuse: 0,
	init: function() {
      // Uninit previous runs to unsubscribe correctly, i.e.
      // so we don't subscribe 100's of times each time we modify
      // and run this macro
      if (window["myXTCMacro"]) {
         macro.status("This macro was run before. Cleaning up...");
         window["myXTCMacro"].uninit();
         window["myXTCMacro"] = undefined;
      }

      // store macro in window object so we have it next time thru
      window["myXTCMacro"] = this;

      // Check for Automatic Toolchange Command
      chilipeppr.subscribe("/com-chilipeppr-widget-serialport/onComplete", this, this.onComplete);
      chilipeppr.subscribe("/com-chilipeppr-widget-serialport/jsonSend", this, this.onJsonSend);
	  chilipeppr.subscribe("/com-chilipeppr-interface-cnccontroller/onExecute", this, this.onATC);
      chilipeppr.subscribe("/com-chilipeppr-interface-cnccontroller/status", this, this.onStateChanged);
      
      chilipeppr.publish("/com-chilipeppr-elem-flashmsg/flashmsg", "XDisPlace Macro", "Send commands to second xdisplace cnccontroller for ATC");
      
      this.getGcode();
   },
   uninit: function() {
      macro.status("Uninitting chilipeppr_pause macro.");
      chilipeppr.unsubscribe("/com-chilipeppr-widget-serialport/onComplete", this, this.onComplete);		
      chilipeppr.unsubscribe("/com-chilipeppr-interface-cnccontroller/onExecute", this, this.onATC);
      chilipeppr.unsubscribe("/com-chilipeppr-interface-cnccontroller/status", this, this.onStateChanged);
      chilipeppr.unsubscribe("/com-chilipeppr-widget-serialport/jsonSend", this, this.onJsonSend);
      this.exeLine = 0;
   },
   onStateChanged: function(state){
      console.log('ATC State:', state, this);
      this.State = state;
      if(this.State === 'End')
         this.exeLine = 0;
   },
	getGcode: function() {
		chilipeppr.subscribe("/com-chilipeppr-widget-gcode/recvGcode", this, this.getGcodeCallback);
		chilipeppr.publish("/com-chilipeppr-widget-gcode/requestGcode", "");
		chilipeppr.unsubscribe("/com-chilipeppr-widget-gcode/recvGcode", this.getGcodeCallback);
	},
	getGcodeCallback: function(data) {
		this.gcode = data;
	},
   // Add control DC Spindle for M3 and M5, M30 will unset all parameters
	onComplete: function(data) {
		console.log('ATC onComplete', data);
		// Id's from the Gcode widget always start with g
		// If you jog, use the serial port console, or do other stuff we'll 
		// see callbacks too, but we only want real gcode data here
		if (data.Id.match(/^g(\d+)/)) {
			// $1 is populated with digits from the .match regex above
			var index = parseInt(RegExp.$1); 
			// our id is always 1 ahead of the gcode.lines array index, i.e.
			// line 1 in the widget is this.gcode.lines[0]
            // Ignore empty lines
			if(this.gcode === undefined)
			   return;

			var gcodeline = this.gcode.lines[index - 1];

            // Ignore empty lines
			if(gcodeline === undefined)
			   return;
			
			// Try to match M3, M5, and M30 (program end)
			// The \b is a word boundary so looking for M3 doesn't also
			// hit on M30
			if (gcodeline.match(/\bM5\b/i) || gcodeline.match(/\bM30\b/i)) {
				// turn spindle off
				chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", "send " + this.serialPortXTC + " brk\n");
			} else if (gcodeline.match(/\bM3\b/i)) {
				// turn spindle on
				chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", "send " + this.serialPortXTC + " fwd 400\n");
			}
		}
	},
    onJsonSend: function(data){
      // test to M6 and try to find the toolnumber
      console.log('ATC data', data);

      if($.type(data) === 'array'){
         var that = this;
         data.forEach(function(gcode){
            that.exeLine++;
            
            if(/T?\d+/.test(gcode.D)){
               var tn = parseInt(gcode.D.match(/T(\d+)/).pop());
               if( tn > 0){
                  that.toolnumber = tn;
                  that.pauseline = that.exeLine;
               }
               console.log('ATC Toolnumber/Pauseline', that.toolnumber, that.pauseline);
            }
         });
      }
   },
   // catch M6 T* in gcode at executet (pause) Time
   // decide to get a new or put first the old tool on holder 
   onATC: function(data){
      console.log('ATC Execute Line:', data, data.line);
      var waitToUnPause = 0;
      // now the machine is in pause mode
      // cuz M6 linenumber are the same as actual linenumber
      // and we can do whatever we like :)
      if(data.line == this.pauseline){
         console.log('ATC Process:', this);

         // check if a different tool in use
         if(this.toolinuse > 0 && this.toolinuse != this.toolnumber){
            this.atc_move_to_holder(this.toolinuse);     // move to holder ...
            setTimeout(this.atc_loose.bind(this), 250);  // put tool in holder
            waitToUnPause += 4000;
         }
         
         // get new tool from holder, if neccessary
         if(this.toolnumber > 0){
            this.atc_move_to_holder(this.toolnumber);    // move to holder ...
            // wait for stop state
            setTimeout(this.atc_tight.bind(this), 250);  // get tool from holder
            waitToUnPause += 4000;
         }
         // wait for tighten process and move to a secure position and unpause this toolchange
         var that = this;
         setTimeout(function () {
             that.unpauseGcode();
         }, waitToUnPause);
      }
   },
   atc_move_to_holder: function( toolnumber ){
      // get parameters for millholder
      var atcparams = this.atcParameters;
      var holder = this.atcMillHolder[ (toolnumber-1) ]; 

      if($.type(holder) !== 'object')
         return;

      // start spindle very slow and set current level
      var cmd = "send " 
                  + this.serialPortXTC + " " 
                  + "fwd " + (atcparams.forward+100) + "\n" 
                  + "fwd " + atcparams.forward + "\n" 
                  + "lev " + atcparams.level + "\n";
      chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", cmd);

      // now move spindle to the holder position
      // first to safetyHeight ...
      cmd += "G0 Z" + atcparams.safetyHeight + "\n";
      // then to holder center ...
      cmd += "G0 X" + holder.posX + " Y" + holder.posY + "\n"; 
      // then to holder Z pre-position height ...
      cmd += "G0 Z" + holder.posZ + "\n";
      // slowly to the minus end ollet Z position  ...
      cmd += "G0 Z" + atcparams.nutZ + " F" + atcparams.feedRate + "\n";
      chilipeppr.publish("/com-chilipeppr-widget-serialport/send", cmd);
   },
   atc_loose: function(){
      // wait on main cnccontroller's stop state (think asynchron!)
      if(this.State != "Stop"){ // wait for stop state
         setTimeout(this.atc_loose.bind(this), 100);
         return;
      }

      // ok state == stop, now we can tighten nut and move the machine 

      var atcparams = this.atcParameters;
      var holder = this.atcMillHolder[ (this.toolinuse-1)];
      
      // loose process
      // rotate backward with more power(+50) as the tight process    
      var cmd = "send " + this.serialPortXTC + " " + "bwd " + (holder.tourque+50) + " " + holder.time + "\n";  
      chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", cmd);

      // ... set the NEGATVE level, if the current go down ... i.e. under 3000mA ... the the collet are loose
      setTimeout(function() { 
         var cmdwait = "send " + this.serialPortXTC + " " + "lev " + atcparams.revlevel + "\n"; 
         chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", cmd);
      }, (holder.time/2)); // <-- half of holder.time

      // unset tool in use
      this.toolinuse = 0;
   },
   atc_tight: function(){
      // wait on main cnccontroller's stop state (think asynchron!)
      if(this.State != "Stop"){ // wait for stop state
         setTimeout(this.atc_tight.bind(this), 100);
         return;
      }

      // ok state == stop, now we can tighten nut and move the machine 

      var atcparams = this.atcParameters;
      var holder = this.atcMillHolder[ (this.toolnumber -1)];
      
      // tighten process
      var cmd = "send " 
                  + this.serialPortXTC + " " 
                  + "fwd " + holder.tourque + " " + holder.time + "\n"
      chilipeppr.publish("/com-chilipeppr-widget-serialport/ws/send", cmd);

      // set tool in use
      this.toolinuse = this.toolnumber;
   },
   unpauseGcode: function() {
      if(this.State != "Stop"){ // wait for stop state
         setTimeout(this.unpauseGcode.bind(this), 500);
         return;
      }
      macro.status("Just unpaused gcode.");
      chilipeppr.publish("/com-chilipeppr-widget-gcode/pause", "");
   },
   distance2time:function(distance){
      return (distance / this.feedRate) * (60*1000); // distane in milliseconds
   },
};
// call init from cp macro loader
// myXTCMacro.init();