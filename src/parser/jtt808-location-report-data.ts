import { readBcdBE } from "../utils/utils";
import { Jtt808ProtocolData } from "./jtt808-protocol-data";

type Jtt808NetworkType =
  | "Unregistered"
  | "GSM"
  | "LTE"
  | "CATM"
  | "NBIOT"
  | "Invalid";
interface BaseStationData {
  MCC: number;
  MNC: number;
  CI: number;
  LAC: number;
  RSSI: number;
}
interface BluetoothData {
  macAddress: string;
  rssi: number;
  deviceName?: string;
  firmwareVersion?: string;
  voltage?: number;
  temperature?: number;
  humidity?: number;
  sensorXYZ?: { x: number; y: number; z: number };
}
interface WifiData {
  macAddress: string;
  rssi: number;
}

interface GNSSExtraData {
  positionAge?: number,
  accOnDuration?: number,
  HDOP?: number,
  time?: Buffer,
}

/**
 * JT/T808 Location Report Data [0x0200]
 *
 * From protocol spec latitude, longitude has (0,0) default value.
 */
export class Jtt808LocationReportData extends Jtt808ProtocolData {
  #isOverspeed: boolean;
  #isGNSSFault: boolean;
  #isUnderVoltage: boolean;
  #isPowerOff: boolean;
  #isRemoveAlarm: boolean;
  #isVibrationAlarm: boolean;
  #isIllegalDisplacement: boolean;

  #isACCOn: boolean;
  #isGNSSPositionFixed: boolean;
  #isVG300BlindDataMode: boolean;
  #isIdleSpeed: boolean;
  #isFuelDisconnected: boolean;
  #networkType: Jtt808NetworkType;
  #isTOWData: boolean;
  #isBufferedData: boolean;

  #latitude: number;
  #longitude: number;
  #altitudeMeter: number;
  #speedKmHr: number;
  #directionDeg: number;
  #timestamp: Date;

  // extra data
  #totalMilleage?: number;
  #mobileSignalStrength?: number;
  #baseStationDataArr?: BaseStationData[];
  #powerSupplyMv?: number;
  #softwareVersion?: string;
  #bluetoothDataArr?: BluetoothData[];
  #wifiDataArr?: WifiData[];

  // TODO parse here
  #extra0XF5?: Buffer;
  #extra0XF6?: Buffer;
  #extra0XF7?: Buffer;
  #extra0XF8?: Buffer;

  // ADAS and DSM active-safety alarm payloads
  #adasAlarm?: any;
  #dsmAlarm?: any;

  #gnssExtraData?: GNSSExtraData;

  constructor(rawData: Buffer) {
    super(rawData);

    const unescapedRawData = this.unescapedRawData;

    // TODO: find actual translation of that words

    // Alarm status (13, 4 bytes)
    // bit 1: Overspeed alarm
    // bit 4: GNSS fault
    // bit 7: Device main power under voltage
    // bit 8: Device main power off
    // bit 15: Remove alarm
    // bit 16: Vibration alarm
    // bit 28: Illegal displacement of the vehicle
    // bit 31: Reserved
    const alarmStatus = unescapedRawData.readUInt32BE(13);

    this.#isOverspeed = !!(alarmStatus & 0x00000002);
    this.#isGNSSFault = !!(alarmStatus & 0x00000010);
    this.#isUnderVoltage = !!(alarmStatus & 0x00000080);
    this.#isPowerOff = !!(alarmStatus & 0x00000100);
    this.#isRemoveAlarm = !!(alarmStatus & 0x00008000);
    this.#isVibrationAlarm = !!(alarmStatus & 0x00010000);
    this.#isIllegalDisplacement = !!(alarmStatus & 0x10000000);

    // GPS status (17, 4 bytes)
    // Bit 6-9 Bit11-26: Reserved default is 0
    // bit 0: 0-ACC off  1-ACC on
    // bit 1: 0-GNSS position unfix  1-GNSS position fix
    // bit 2: 0-north latitude 1-south latitude
    // bit 3: 0-east longitude 1-west longitude
    // bit 4: 0-real time data flag 1-blind data flag（Only for VG300 flag bits)
    // bit 5: 0-Non idle speed  1-dle speed
    // bit 10: 0-fuel connect 1-fuel disconnect
    // bit 27-29: network modes; 000-UNREGISTERED; 001-GSM; 010-LTE; 011-CATM; 100-NBIOT
    // bit 30: 0-normal data 1-TOW data
    // bit 31: 0-real time data 1-buffer data
    const gpsStatus = unescapedRawData.readUInt32BE(17);

    this.#isACCOn = !!(gpsStatus & 0x00000001);
    this.#isGNSSPositionFixed = !!(gpsStatus & 0x00000002);
    const isSouthern = !!(gpsStatus & 0x00000004);
    const isWestern = !!(gpsStatus & 0x00000008);
    this.#isVG300BlindDataMode = !!(gpsStatus & 0x00000010);
    this.#isIdleSpeed = !!(gpsStatus & 0x00000020);
    this.#isFuelDisconnected = !!(gpsStatus & 0x00000400);
    const networkType = (gpsStatus & 0x38000000) >> 27;
    if (networkType === 0b000) {
      this.#networkType = "Unregistered";
    } else if (networkType === 0b001) {
      this.#networkType = "GSM";
    } else if (networkType === 0b010) {
      this.#networkType = "LTE";
    } else if (networkType === 0b011) {
      this.#networkType = "CATM";
    } else if (networkType === 0b100) {
      this.#networkType = "NBIOT";
    } else {
      this.#networkType = "Invalid";
    }
    this.#isTOWData = !!(gpsStatus & 0x40000000);
    this.#isBufferedData = !!(gpsStatus & 0x80000000);

    // Latitude data (21, 4 bytes)
    const latitude = unescapedRawData.readUInt32BE(21);
    const latValue = latitude / 10e5;
    if (isSouthern) {
      this.#latitude = -latValue;
    } else {
      this.#latitude = latValue;
    }

    // Longitude data (25, 4 bytes)
    const longitude = unescapedRawData.readUInt32BE(25);
    const lngValue = longitude / 10e5;
    if (isWestern) {
      this.#longitude = -lngValue;
    } else {
      this.#longitude = lngValue;
    }

    // Altitude data (29, 2 bytes)
    this.#altitudeMeter = unescapedRawData.readUInt16BE(29);

    // TODO what is 1/10 km/hr
    // Speed data (31, 2 bytes)
    const speed = unescapedRawData.readUInt16BE(31);
    this.#speedKmHr = speed * 10;

    // Direction data (33, 2 bytes)
    this.#directionDeg = unescapedRawData.readUInt16BE(33);

    // Time data (35, 6 bytes) bcd;
    // YY-MM-DD-hh-mm-ss UTC
    const yearBCD = readBcdBE(unescapedRawData, 35, 1);
    const year = 2000 + parseInt(yearBCD, 10); // assume in year 2000
    const monthBCD = readBcdBE(unescapedRawData, 36, 1);
    const month = parseInt(monthBCD, 10);
    const dateBCD = readBcdBE(unescapedRawData, 37, 1);
    const date = parseInt(dateBCD, 10);
    const hourBCD = readBcdBE(unescapedRawData, 38, 1);
    const hour = parseInt(hourBCD, 10);
    const minBCD = readBcdBE(unescapedRawData, 39, 1);
    const min = parseInt(minBCD, 10);
    const secBCD = readBcdBE(unescapedRawData, 40, 1);
    const sec = parseInt(secBCD, 10);

    this.#timestamp = new Date(Date.UTC(year, month - 1, date, hour, min, sec));

    // extended data
    // start from byte 41 to n - 3
    let bytePointer = 41;
    let bytePointer2: number;
    let bitmask;


    const ADAS_STATES = ["unavailable", "start", "end"];

    const ADAS_TYPES: Record<number, string> = {
      1: "forward collision",
      2: "lane departure",
      3: "following too close",
      4: "pedestrian collision",
      5: "frequent lane change",
      6: "road sign limit exceeded",
      7: "obstacle",
      16: "road sign recognition",
      17: "active capture",
    };

    const DEPARTURE_TYPES: Record<number, string> = {
      1: "left",
      2: "right",
    };

    interface AdasAlarm {
      alarmId: number;
      state: string | number;
      type: string;
      typeCode: number;
      level: number;
      frontVehicleSpeedKmh: number;
      frontDistance: number;
      departureType: string | number;
      roadSignType: number;
      roadSignData: number;
      speedKmh: number;
      altitude: number;
      latitude: number;
      longitude: number;
      time: string;
      vehicleStatus: number;
      identifier: {
        terminalId: string;
        time: string;
        sequenceNo: number;
        attachmentCount: number;
      };
    }

    /**
     * Parses additional item 0x64 (ADAS / forward camera alarm).
     * 2013 format: 47 bytes. 2019 format: 71 bytes (longer terminal ID and reserved field).
     */
    function parseAdasAlarm(value: Buffer, is2019 = false): AdasAlarm {
      const terminalIdLength = is2019 ? 30 : 7;
      const identifierStart = 31;
      const typeCode = value[5];

      return {
        alarmId: value.readUInt32BE(0),
        state: ADAS_STATES[value[4]] ?? value[4],
        type: ADAS_TYPES[typeCode] ?? `user-defined (${typeCode})`,
        typeCode,
        level: value[6],
        frontVehicleSpeedKmh: value[7],
        frontDistance: value[8],                       // time gap in 100 ms units
        departureType: DEPARTURE_TYPES[value[9]] ?? value[9],
        roadSignType: value[10],
        roadSignData: value[11],
        speedKmh: value[12],
        altitude: value.readUInt16BE(13),
        latitude: value.readUInt32BE(15) / 1e6,
        longitude: value.readUInt32BE(19) / 1e6,
        time: bcdTime(value.subarray(23, 29)),
        vehicleStatus: value.readUInt16BE(29),
        identifier: {
          terminalId: value
            .subarray(identifierStart, identifierStart + terminalIdLength)
            .toString("ascii")
            .replace(/\0/g, ""),
          time: bcdTime(value.subarray(identifierStart + terminalIdLength, identifierStart + terminalIdLength + 6)),
          sequenceNo: value[identifierStart + terminalIdLength + 6],
          attachmentCount: value[identifierStart + terminalIdLength + 7],
        },
      };
    }

    const DSM_TYPES: Record<number, string> = {
      1: "fatigue driving",
      2: "phone call",
      3: "smoking",
      4: "distracted driving",
      5: "driver abnormal",
      6: "camera blocked",
      8: "overtime driving",
      10: "seatbelt not fastened",
      11: "IR-blocking sunglasses",
      12: "both hands off wheel",
      13: "playing with phone",
      16: "automatic capture",
      17: "driver change",
    };

    interface DsmAlarm {
      alarmId: number;
      state: string | number;
      type: string;
      typeCode: number;
      level: number;
      fatigueDegree: number;
      speedKmh: number;
      altitude: number;
      latitude: number;
      longitude: number;
      time: string;
      vehicleStatus: number;
      identifier: {
        terminalId: string;
        time: string;
        sequenceNo: number;
        attachmentCount: number;
      };
    }
    /** Converts 6 BCD bytes (YYMMDDHHMMSS) to "20YY-MM-DD HH:MM:SS" */
    function bcdTime(bytes: Buffer): string {
      const s = bytes.toString("hex");
      return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)} ${s.slice(6, 8)}:${s.slice(8, 10)}:${s.slice(10, 12)}`;
    }

    const DSM_STATES = ["unavailable", "start", "end"];

    /**
     * Parses additional item 0x65 (DSM / driver monitoring alarm).
     * 2013 format: 47 bytes. 2019 format: 71 bytes (longer terminal ID and reserved field).
     */
    function parseDsmAlarm(value: Buffer, is2019 = false): DsmAlarm {
      const terminalIdLength = is2019 ? 30 : 7;
      const identifierStart = 31;
      const typeCode = value[5];

      return {
        alarmId: value.readUInt32BE(0),
        state: DSM_STATES[value[4]] ?? value[4],
        type: DSM_TYPES[typeCode] ?? `user-defined (${typeCode})`,
        typeCode,
        level: value[6],
        fatigueDegree: value[7],
        // bytes 8–11: reserved
        speedKmh: value[12],
        altitude: value.readUInt16BE(13),
        latitude: value.readUInt32BE(15) / 1e6,
        longitude: value.readUInt32BE(19) / 1e6,
        time: bcdTime(value.subarray(23, 29)),
        vehicleStatus: value.readUInt16BE(29),
        identifier: {
          terminalId: value
            .subarray(identifierStart, identifierStart + terminalIdLength)
            .toString("ascii")
            .replace(/\0/g, ""),
          time: bcdTime(value.subarray(identifierStart + terminalIdLength, identifierStart + terminalIdLength + 6)),
          sequenceNo: value[identifierStart + terminalIdLength + 6],
          attachmentCount: value[identifierStart + terminalIdLength + 7],
        },
      };
    }





    while (bytePointer < unescapedRawData.length - 2) {
      //const header = unescapedRawData.readUInt8(bytePointer);
      //const extraLength = unescapedRawData.readUInt8(bytePointer + 1);

      const id = unescapedRawData.readUInt8(bytePointer);
      const length = unescapedRawData.readUInt8(bytePointer + 1);
      const value = unescapedRawData.subarray(bytePointer + 2, bytePointer + 2 + length);

      switch (id) {
        case 0x01:
          this.#totalMilleage = value.readUInt32BE(0) / 10;
          break;
        case 0x30:
          this.#mobileSignalStrength = value.readUInt8(0);
          break;
        case 0x64:
          this.#adasAlarm = parseAdasAlarm(value);
          break;
        case 0x65:
          this.#dsmAlarm = parseDsmAlarm(value);
          break;
        // ...other cases, always reading from `value` at offset 0
      }


      bytePointer += 2 + length;
    }
  }

  get isOverspeed() {
    return this.#isOverspeed;
  }

  get isGNSSFault() {
    return this.#isGNSSFault;
  }

  get isUnderVoltage() {
    return this.#isUnderVoltage;
  }

  get isPowerOff() {
    return this.#isPowerOff;
  }

  get isRemoveAlarm() {
    return this.#isRemoveAlarm;
  }

  get isVibrationAlarm() {
    return this.#isVibrationAlarm;
  }

  get isIllegalDisplacement() {
    return this.#isIllegalDisplacement;
  }

  get isACCOn() {
    return this.#isACCOn;
  }

  get isGNSSPositionFixed() {
    return this.#isGNSSPositionFixed;
  }

  get isVG300BlindDataMode() {
    return this.#isVG300BlindDataMode;
  }

  get isIdleSpeed() {
    return this.#isIdleSpeed;
  }

  get isFuelDisconnected() {
    return this.#isFuelDisconnected;
  }

  /**
   * GPS Network Type
   */
  get networkType() {
    return this.#networkType;
  }

  get isTOWData() {
    return this.#isTOWData;
  }

  /**
   * Is Buffered Data
   *
   * true: Buffered data
   *
   * false: Real-time data
   */
  get isBufferedData() {
    return this.#isBufferedData;
  }

  /**
   * GPS Latitude
   *
   * Positive is Northern
   *
   * Negative is Southern
   */
  get latitude() {
    return this.#latitude;
  }

  /**
   * GPS Longitude
   *
   * Positive is Eastern
   *
   * Negative is Western
   */
  get longitude() {
    return this.#longitude;
  }

  /**
   * GPS Altitude in meter unit
   */
  get altitudeMeter() {
    return this.#altitudeMeter;
  }

  /**
   * GPS Speed in km/hr unit
   */
  get speedKmHr() {
    return this.#speedKmHr;
  }

  /**
   * GPS Direction in Degree unit
   *
   * Start from North (0); Clockwise (to 359)
   */
  get directionDeg() {
    return this.#directionDeg;
  }

  /**
   * GPS Timestamp
   */
  get timestamp() {
    return this.#timestamp;
  }

  /**
   * Total Milleage in km unit
   *
   * undefined if not exists
   */
  get totalMilleage() {
    return this.#totalMilleage;
  }

  /**
   * Mobile Signal Strength
   *
   * undefined if not exists
   */
  get mobileSignalStrength() {
    return this.#mobileSignalStrength;
  }

  /**
   * Base Station Data Array
   *
   * undefined if not exists
   */
  get baseStationDataArr() {
    return this.#baseStationDataArr;
  }

  /**
   * Power Supply Voltage in mV
   *
   * undefined if not exists
   */
  get powerSupplyMv() {
    return this.#powerSupplyMv;
  }

  /**
   * Software Version
   *
   * undefined if not exists
   */
  get softwareVersion() {
    return this.#softwareVersion;
  }

  /**
   * Bluetooth Data Array
   *
   * undefined if not exists
   */
  get bluetoothDataArr() {
    return this.#bluetoothDataArr;
  }

  /**
   * Wifi Data Array
   *
   * undefined if not exists
   */
  get wifiDataArr() {
    return this.#wifiDataArr;
  }

  get extra0XF5() {
    return this.#extra0XF5;
  }
  get extra0XF6() {
    return this.#extra0XF6;
  }
  get extra0XF7() {
    return this.#extra0XF7;
  }
  get extra0XF8() {
    return this.#extra0XF8;
  }

  /**
   * GNSS Extra Data
   * 
   * undefined if not exists
   */
  get gnssExtraData() {
    return this.#gnssExtraData;
  }

  get adasAlarmData() {
    return this.#adasAlarm;
  }

  get dsmAlarmData() {
    return this.#dsmAlarm;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      // isOverspeed: this.isOverspeed,
      // isGNSSFault: this.isGNSSFault,
      // isUnderVoltage: this.isUnderVoltage,
      // isPowerOff: this.isPowerOff,
      // isVibrationAlarm: this.isVibrationAlarm,
      // isIllegalDisplacement: this.isIllegalDisplacement,
      // isACCOn: this.isACCOn,
      // isGNSSPositionFixed: this.isGNSSPositionFixed,
      // isVG300BlindDataMode: this.isVG300BlindDataMode,
      // isIdleSpeed: this.isIdleSpeed,
      // isFuelDisconnected: this.isFuelDisconnected,
      // networkType: this.networkType,
      // isTOWData: this.isTOWData,
      // isBufferedData: this.isBufferedData,
      // latitude: this.latitude,
      // longitude: this.longitude,
      // altitudeMeter: this.altitudeMeter,
      // speedKmHr: this.speedKmHr,
      // directionDeg: this.directionDeg,
      // timestamp: this.timestamp,
      totalMilleage: this.totalMilleage,
      mobileSignalStrength: this.mobileSignalStrength,
      // baseStationDataArr: this.baseStationDataArr,
      // powerSupplyMv: this.powerSupplyMv,
      // softwareVersion: this.softwareVersion,
      // bluetoothDataArr: this.bluetoothDataArr,
      // wifiDataArr: this.wifiDataArr,
      // extra0XF5: this.extra0XF5,
      // extra0XF6: this.extra0XF6,
      // extra0XF7: this.extra0XF7,
      // extra0XF8: this.extra0XF8,
      adasAlarmData: this.adasAlarmData,
      dsmAlarmData: this.dsmAlarmData,
      // gnssExtraData: this.gnssExtraData ? {
      //   positionAge: this.gnssExtraData.positionAge,
      //   accOnDuration: this.gnssExtraData.accOnDuration,
      //   HDOP: this.gnssExtraData.HDOP,
      //   time: this.gnssExtraData.time?.toString("hex"),
      // } : undefined,
    };
  }
}
