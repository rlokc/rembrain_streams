import { Subject, ReplaySubject, Observable } from 'rxjs'
import { RobotImageData, RobotState, RobotData } from './entities'
import { Image } from 'image-js'
import { Buffer } from 'buffer/'
import { IOperatorProps } from './entities'

export interface IImageReceiver {
  imageSubject: Observable<RobotImageData>
  depthSubject: Observable<Image>
  dataSubject: Observable<RobotData>
  stateSubject: Observable<RobotState>

  shutdown(): void
}

export class WebSocketImageReceiver implements IImageReceiver {
  dataWebsocket: WebSocket
  stateWebsocket: WebSocket
  dataURL: string
  robotName: string
  accessToken: string

  public constructor(settings: IOperatorProps) {
    this.dataURL = settings.dataWSUrl
    this.robotName = settings.robotName
    this.accessToken = settings.accessToken

    this.openDataWebsocket()
    this.openStateWebsocket()
  }

  openDataWebsocket() {
    this.dataWebsocket = new WebSocket(this.dataURL)
    this.dataWebsocket.onopen = this.onDataOpen
    this.dataWebsocket.onclose = this.onDataClosed
    this.dataWebsocket.onerror = this.onDataError
    this.dataWebsocket.onmessage = this.onDataMessage
  }

  sendDataInitPacket() {
    let controlPacket = {
      command: 'pull',
      exchange: `camera0`,
      robot_name: this.robotName,
      accessToken: this.accessToken
    }
    // console.log("Sending", controlPacket);
    this.dataWebsocket.send(JSON.stringify(controlPacket))
  }

  imageSubject = new ReplaySubject<RobotImageData>(1)
  depthSubject = new ReplaySubject<Image>(1)
  dataSubject = new ReplaySubject<RobotData>(1)

  onDataOpen = (ev: Event) => {
    console.log('Data Websocket Opened', ev)
    this.sendDataInitPacket()
  }

  onDataClosed = (ev: CloseEvent) => {
    console.log('Data Websocket Closed', ev)
    console.log('Trying to open the websocket again')
    this.openDataWebsocket()
  }

  onDataError = (ev: Event) => {
    console.log('Data Websocket Error', ev)
  }

  onDataMessage = (ev: any) => {
    this.unpackData(ev.data)
  }

  async unpackData(data: Blob | string) {
    if (typeof data === 'string') {
      console.error('Error unpacking video feed:', data)
      return
    }
    let dataType = new Uint8Array(await data.slice(0, 1).arrayBuffer())[0]
    if (dataType != 1) {
      console.log(`Data type ${dataType} isn't JPG+PNG(1)`)
    } else {
      const HEADER_END = 13
      // 1st byte is the type of image, for now assuming it's JPG+PNG and skip it
      let lengths = new Uint32Array(
        await data.slice(1, HEADER_END).arrayBuffer()
      )
      // Get blobs for each of the images + text
      // image is the video feed in JPG
      let imageBlob = data.slice(HEADER_END, HEADER_END + lengths[0])
      // depth is in PNG
      let depthBlob = data.slice(
        HEADER_END + lengths[0],
        HEADER_END + lengths[0] + lengths[1]
      )
      let statusBlob = data.slice(
        HEADER_END + lengths[0] + lengths[1],
        HEADER_END + lengths[0] + lengths[1] + lengths[2]
      )

      imageBlob.arrayBuffer().then(
        (val) => {
          let imData = {
            data: Buffer.from(val),
            type: 'image/jpg'
          }
          this.imageSubject.next(imData)
        },
        (err) => console.log('Error while sending image:', err)
      )

      depthBlob
        .arrayBuffer()
        .then(
          (val) => Image.load(val),
          (err) => console.log('Error while loading depth map: ', err)
        )
        .then((depth) => {
          if (!depth) return
          this.depthSubject.next(depth)
        })

      statusBlob.text().then(
        (val) => this.dataSubject.next(JSON.parse(val)),
        (err) => console.log('Error while getting status:', err)
      )
    }
  }

  stateSubject = new ReplaySubject<RobotState>(1)

  openStateWebsocket() {
    this.stateWebsocket = new WebSocket(this.dataURL)
    this.stateWebsocket.onopen = this.onStateOpen
    this.stateWebsocket.onclose = this.onStateClosed
    this.stateWebsocket.onerror = this.onStateError
    this.stateWebsocket.onmessage = this.onStateMessage
  }

  sendStateInitPacket() {
    let controlPacket = {
      command: 'pull',
      exchange: `state`,
      robot_name: this.robotName,
      accessToken: this.accessToken
    }
    this.stateWebsocket.send(JSON.stringify(controlPacket))
  }

  onStateClosed = (ev: CloseEvent) => {
    console.log('State Websocket Closed', ev)
    console.log('Trying to open the websocket again')
    this.openStateWebsocket()
  }

  onStateOpen = (ev: Event) => {
    console.log('State Websocket Opened', ev)
    this.sendStateInitPacket()
  }

  onStateError = (ev: Event) => {
    console.log('State Websocket Error', ev)
  }

  onStateMessage = (ev: any) => {
    this.unpackState(ev.data)
  }

  unpackState(data: Blob | string) {
    if (typeof data === 'string') {
      console.error('Error unpacking robot state:', data)
      return
    }
    data.text().then((res) => this.stateSubject.next(JSON.parse(res)))
  }

  public shutdown() {
    this.dataWebsocket.onclose = null
    this.stateWebsocket.onclose = null
    this.dataWebsocket.close()
    this.stateWebsocket.close()
  }
}
