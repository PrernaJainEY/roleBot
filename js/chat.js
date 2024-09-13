// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var messages = [];
var messageInitiated = false;
var dataSources = [];
var sentenceLevelPunctuations = [
  ".",
  "?",
  "!",
  ":",
  ";",
  "。",
  "？",
  "！",
  "：",
  "；",
];
var enableQuickReply = false;
var quickReplies = [
  "Let me take a look.",
  "Let me check.",
  "One moment, please.",
];
var byodDocRegex = new RegExp(/\[doc(\d+)\]/g);
var isSpeaking = false;
var spokenTextQueue = [];
var sessionActive = false;
var lastSpeakTime;
var configuration = {
  cogSvcRegion: "westus2",
  cogSvcSubKey: "3b8c1ffc22d043e9b36271a40e104be6",
  azureOpenAIEndpoint: "https://swcdaoipocaoa15.openai.azure.com",
  azureOpenAIApiKey: "faaf969f35384d0b82ebe9405dc914da",
  azureOpenAIDeploymentName: "gpt_4_32k",
};
// Connect to avatar service

function connectAvatar() {
  const cogSvcRegion = configuration["cogSvcRegion"]; //document.getElementById('region').value
  const cogSvcSubKey = configuration["cogSvcSubKey"]; //document.getElementById('subscriptionKey').value
  if (cogSvcSubKey === "") {
    alert("Please fill in the subscription key of your speech resource.");
    return;
  }

  const privateEndpointEnabled = document.getElementById(
    "enablePrivateEndpoint"
  ).checked;
  const privateEndpoint = document
    .getElementById("privateEndpoint")
    .value.slice(8);
  if (privateEndpointEnabled && privateEndpoint === "") {
    alert("Please fill in the Azure Speech endpoint.");
    return;
  }

  let speechSynthesisConfig;
  if (privateEndpointEnabled) {
    speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(
      new URL(
        `wss://${privateEndpoint}/tts/cognitiveservices/websocket/v1?enableTalkingAvatar=true`
      ),
      cogSvcSubKey
    );
  } else {
    speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(
      cogSvcSubKey,
      cogSvcRegion
    );
  }
  speechSynthesisConfig.endpointId = document.getElementById(
    "customVoiceEndpointId"
  ).value;

  const talkingAvatarCharacter = document.getElementById(
    "talkingAvatarCharacter"
  ).value;
  const talkingAvatarStyle =
    document.getElementById("talkingAvatarStyle").value;
  const avatarConfig = new SpeechSDK.AvatarConfig(
    talkingAvatarCharacter,
    talkingAvatarStyle
  );
  avatarConfig.customized = document.getElementById("customizedAvatar").checked;
  avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(
    speechSynthesisConfig,
    avatarConfig
  );
  avatarSynthesizer.avatarEventReceived = function (s, e) {
    var offsetMessage =
      ", offset from session start: " + e.offset / 10000 + "ms.";
    if (e.offset === 0) {
      offsetMessage = "";
    }

    console.log("Event received: " + e.description + offsetMessage);
  };

  const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(
    new URL(
      `wss://${cogSvcRegion}.stt.speech.microsoft.com/speech/universal/v2`
    ),
    cogSvcSubKey
  );
  speechRecognitionConfig.setProperty(
    SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode,
    "Continuous"
  );
  var sttLocales = document.getElementById("sttLocales").value.split(",");
  var autoDetectSourceLanguageConfig =
    SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(sttLocales);
  speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
    speechRecognitionConfig,
    autoDetectSourceLanguageConfig,
    SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
  );

  const azureOpenAIEndpoint = configuration["azureOpenAIEndpoint"]; //document.getElementById('azureOpenAIEndpoint').value
  const azureOpenAIApiKey = configuration["azureOpenAIApiKey"]; //document.getElementById('azureOpenAIApiKey').value
  const azureOpenAIDeploymentName = configuration["azureOpenAIDeploymentName"]; // document.getElementById('azureOpenAIDeploymentName').value
  if (
    azureOpenAIEndpoint === "" ||
    azureOpenAIApiKey === "" ||
    azureOpenAIDeploymentName === ""
  ) {
    alert(
      "Please fill in the Azure OpenAI endpoint, API key and deployment name."
    );
    return;
  }

  dataSources = [];
  if (document.getElementById("enableOyd").checked) {
    const azureCogSearchEndpoint = "https://swcdaoipocaoa15.openai.azure.com"; //document.getElementById('azureCogSearchEndpoint').value
    const azureCogSearchApiKey = "faaf969f35384d0b82ebe9405dc914da"; //document.getElementById('azureCogSearchApiKey').value
    const azureCogSearchIndexName = document.getElementById(
      "azureCogSearchIndexName"
    ).value;
    if (
      azureCogSearchEndpoint === "" ||
      azureCogSearchApiKey === "" ||
      azureCogSearchIndexName === ""
    ) {
      alert(
        "Please fill in the Azure Cognitive Search endpoint, API key and index name."
      );
      return;
    } else {
      setDataSources(
        azureCogSearchEndpoint,
        azureCogSearchApiKey,
        azureCogSearchIndexName
      );
    }
  }

  // Only initialize messages once
  if (!messageInitiated) {
    initMessages();
    messageInitiated = true;
  }

  document.getElementById("startSession").disabled = true;
  document.getElementById("configuration").hidden = true;
  document.getElementsByClassName("microphoneButton").hidden = false;

  const xhr = new XMLHttpRequest();
  if (privateEndpointEnabled) {
    xhr.open(
      "GET",
      `https://${privateEndpoint}/tts/cognitiveservices/avatar/relay/token/v1`
    );
  } else {
    xhr.open(
      "GET",
      `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`
    );
  }
  xhr.setRequestHeader("Ocp-Apim-Subscription-Key", cogSvcSubKey);
  xhr.addEventListener("readystatechange", function () {
    if (this.readyState === 4) {
      const responseData = JSON.parse(this.responseText);
      const iceServerUrl = responseData.Urls[0];
      const iceServerUsername = responseData.Username;
      const iceServerCredential = responseData.Password;
      setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential);
    }
  });
  xhr.send();
}

// Disconnect from avatar service
function disconnectAvatar() {
  if (avatarSynthesizer !== undefined) {
    avatarSynthesizer.close();
  }

  if (speechRecognizer !== undefined) {
    speechRecognizer.stopContinuousRecognitionAsync();
    speechRecognizer.close();
  }

  sessionActive = false;
}
// function makeBackgroundTransparent(timestamp) {
//     // Throttle the frame rate to 30 FPS to reduce CPU usage
//     if (timestamp - previousAnimationFrameTimestamp > 30) {
//         video = document.getElementById('video')
//         tmpCanvas = document.getElementById('tmpCanvas')
//         tmpCanvasContext = tmpCanvas.getContext('2d', { willReadFrequently: true })
//         tmpCanvasContext.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
//         if (video.videoWidth > 0) {
//             let frame = tmpCanvasContext.getImageData(0, 0, video.videoWidth, video.videoHeight)
//             for (let i = 0; i < frame.data.length / 4; i++) {
//                 let r = frame.data[i * 4 + 0]
//                 let g = frame.data[i * 4 + 1]
//                 let b = frame.data[i * 4 + 2]
//                 if (g - 150 > r + b) {
//                     // Set alpha to 0 for pixels that are close to green
//                     frame.data[i * 4 + 3] = 0
//                 } else if (g + g > r + b) {
//                     // Reduce green part of the green pixels to avoid green edge issue
//                     adjustment = (g - (r + b) / 2) / 3
//                     r += adjustment
//                     g -= adjustment * 2
//                     b += adjustment
//                     frame.data[i * 4 + 0] = r
//                     frame.data[i * 4 + 1] = g
//                     frame.data[i * 4 + 2] = b
//                     // Reduce alpha part for green pixels to make the edge smoother
//                     a = Math.max(0, 255 - adjustment * 4)
//                     frame.data[i * 4 + 3] = a
//                 }
//             }

//             canvas = document.getElementById('canvas')
//             canvasContext = canvas.getContext('2d')
//             canvasContext.putImageData(frame, 0, 0);
//         }

//         previousAnimationFrameTimestamp = timestamp
//     }

//     window.requestAnimationFrame(makeBackgroundTransparent)
// }
// Setup WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
  // Create WebRTC peer connection
  peerConnection = new RTCPeerConnection({
    iceServers: [
      {
        urls: [iceServerUrl],
        username: iceServerUsername,
        credential: iceServerCredential,
      },
    ],
  });

  // Fetch WebRTC video stream and mount it to an HTML video element
  peerConnection.ontrack = function (event) {
    // Clean up existing video element if there is any
    remoteVideoDiv = document.getElementById("remoteVideo");
    for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
      if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
        remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i]);
      }
    }

    if (event.track.kind === "audio") {
      let audioElement = document.createElement("audio");
      audioElement.id = "audioPlayer";
      audioElement.srcObject = event.streams[0];
      audioElement.autoplay = true;

      audioElement.onplaying = () => {
        console.log(`WebRTC ${event.track.kind} channel connected.`);
      };

      document.getElementById("remoteVideo").appendChild(audioElement);
    }

    if (event.track.kind === "video") {
      document.getElementById("remoteVideo").style.width = "0.1px";
      if (!document.getElementById("useLocalVideoForIdle").checked) {
        document.getElementById("chatHistory").hidden = true;
      }

      let videoElement = document.createElement("video");
      videoElement.id = "videoPlayer";
      videoElement.srcObject = event.streams[0];
      videoElement.autoplay = true;
      videoElement.playsInline = true;
      // window.requestAnimationFrame(makeBackgroundTransparent)
      videoElement.onplaying = () => {
        console.log(`WebRTC ${event.track.kind} channel connected.`);
        document.getElementById("microphone").disabled = false;
        document.getElementById("stopSession").disabled = false;
        document.getElementById("form-container").style.display = "none";
        document.getElementById("chatBotContainer").style.display = "flex";
        // document.getElementById("remoteVideo").style.width = "90%";

        // document.getElementById('remoteVideo').style.backgroundImage="url('../tts UI/image/ey_background.png')";
        // document.getElementById('remoteVideo').style.backgroundSize="cover";

        document.getElementById("chatHistory").hidden = false;
        document.getElementById("microphoneButton1").style.display = "flex";
        document.getElementById("continuousConversationDiv").hidden = true;

        if (document.getElementById("useLocalVideoForIdle").checked) {
          document.getElementById("localVideo").hidden = true;
          if (lastSpeakTime === undefined) {
            lastSpeakTime = new Date();
          }
        }

        setTimeout(() => {
          sessionActive = true;
        }, 5000); // Set session active after 5 seconds
      };

      document.getElementById("remoteVideo").appendChild(videoElement);
      let chatUserDiv = document.createElement("div");
      chatUserDiv.classList.add("assistant");

      let chatContainer = document.getElementById("chatHistory");
      chatContainer.append(chatUserDiv);
      chatUserDiv.innerText += ` Hello , welcome! It’s great to have you here today. 
        1.In this interview, you’ll be interacting with our AI bot using voice input to evaluate how well the bot handles spoken queries.
        2.On your screen, you should see a microphone button. It’s typically represented by an icon of a microphone. If you’re using microphone, the button should be located  at the bottom of the chat window .
        3.To start speaking, click on the microphone button. Once you click it, you’ll be able to speak into your microphone. The button may change color or display a recording symbol to indicate that it’s active.
        4.When you’re done speaking, click the microphone button again to stop recording. The AI bot will process your voice input and respond accordingly.
        So Are you ready for the interview?`;
      // chatHistoryTextArea.innerHTML += `${displaySentence}`
      chatContainer.scrollTop = chatContainer.scrollHeight;
      speakFirst(
        `Hello , welcome! It’s great to have you here today. 
        In this interview, you’ll be interacting with our AI bot using voice input to evaluate how well the bot handles spoken queries.
        On your screen, you should see a microphone button. It’s typically represented by an icon of a microphone. If you’re using microphone, the button should be located  at the bottom of the chat window .
        To start speaking, click on the microphone button. Once you click it, you’ll be able to speak into your microphone. The button may change color or display a recording symbol to indicate that it’s active.
        When you’re done speaking, click the microphone button again to stop recording. The AI bot will process your voice input and respond accordingly.
          So Are you ready for the interview?
        `,
        1
      );
     
      displaySentence = "";
    }
  };

  // Make necessary update to the web page when the connection state changes
  peerConnection.oniceconnectionstatechange = (e) => {
    console.log("WebRTC status: " + peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === "disconnected") {
      if (document.getElementById("useLocalVideoForIdle").checked) {
        document.getElementById("localVideo").hidden = false;
        document.getElementById("remoteVideo").style.width = "0.1px";
      }
    }
  };

  // Offer to receive 1 audio, and 1 video track
  peerConnection.addTransceiver("video", { direction: "sendrecv" });
  peerConnection.addTransceiver("audio", { direction: "sendrecv" });

  // start avatar, establish WebRTC connection
  avatarSynthesizer
    .startAvatarAsync(peerConnection)
    .then((r) => {
      if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
        console.log(
          "[" +
            new Date().toISOString() +
            "] Avatar started. Result ID: " +
            r.resultId
        );
      } else {
        console.log(
          "[" +
            new Date().toISOString() +
            "] Unable to start avatar. Result ID: " +
            r.resultId
        );
        if (r.reason === SpeechSDK.ResultReason.Canceled) {
          let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r);
          if (
            cancellationDetails.reason === SpeechSDK.CancellationReason.Error
          ) {
            console.log(cancellationDetails.errorDetails);
          }

          console.log(
            "Unable to start avatar: " + cancellationDetails.errorDetails
          );
        }
        document.getElementById("startSession").disabled = false;
        document.getElementById("configuration").hidden = true;
      }
    })
    .catch((error) => {
      console.log(
        "[" +
          new Date().toISOString() +
          "] Avatar failed to start. Error: " +
          error
      );
      document.getElementById("startSession").disabled = false;
      document.getElementById("configuration").hidden = true;
    });
}
//access microphone
function requestMicrophone() {
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(function (stream) {
      // Microphone access granted
      // `stream` represents the audio stream from the microphone
    })
    .catch(function (err) {
      // Microphone access denied or some other error
      console.error("Error accessing microphone:", err);
    });
}

function initMessages() {
  const job_title =
    document.getElementById("job_title").value || "Sales Manager";
  const job_desc =
    document.getElementById("job_desc").value ||
    "A Sales Manager responsible for leading and managing the sales team, developing sales strategies, identifying new business opportunities, and driving revenue growth. The role involves collaborating with cross-functional teams, ensuring customer satisfaction, and achieving sales targets.";
  const requiredSkills =
    document.getElementById("job_skills").value ||
    `
- Strong leadership and team management abilities
- Excellent communication and negotiation skills
- Proven experience in developing and executing successful sales strategies
- In-depth knowledge of sales metrics, analytics, and forecasting
- Proficiency in CRM software and sales management tools
- Experience in building and maintaining client relationships
    `;
  const focusSkills =
    document.getElementById("focus_areas").value ||
    `- Leadership and team management
- Sales strategy development and execution
- Performance analytics and forecasting
- Customer relationship management
- Negotiation and communication`;
  const experience = document.getElementById("experience").value || 5;
  messages = [];

  if (dataSources.length === 0) {
   
    let systemPrompt = 
    `You are an AI Technical Recruiter and Competency Expert with 25 years of experience conducting technical interviews. Your task is to conduct a thorough and engaging 20-minute technical interview for the position of ${job_title}

#Job Description:
${job_desc}
#Required Skills:
${requiredSkills}
#Key Focus Areas:
${focusSkills}

#Experience Level: 
${experience} years

#Company Culture: 
A dynamic, results-driven environment that values innovation, teamwork, and a customer-centric approach.

#Instructions:
You are an AI assistant designed to conduct job interviews. Your goal is to ask one question at a time based on the user's responses. Avoid providing any feedback on whether the answers are correct or incorrect. Instead, focus on asking the next relevant question to proceed with the interview. Ensure the conversation flows naturally and guide the user through the interview process step-by-step.
1. Begin the interview by briefly explaining the interview process in 2-3 lines.
2. Ask a mix of technical questions, problem-solving scenarios, and experience-based questions that align with the job description and required skills one at a time.
3. Dive deep into the candidate's knowledge of sales strategy development and execution, as this is crucial for the role.
4. Include at least one scenario-based question related to managing a sales team or handling a challenging client situation.
5. Assess the candidate's problem-solving approach and communication skills throughout the interview.
6. Allow time for the candidate to ask questions about the role or company.
7. Adapt your questions based on the candidate's responses to ensure a thorough evaluation of their skills and experience.
8. Maintain a professional yet friendly tone, reflecting the company culture described above.
9. End the interview by thanking the candidate and explaining the next steps in the process.

#Remember to:
- Keep track of time to ensure all key areas are covered within the 20-minute limit.
- ask question one by one
- Provide clear instructions for any technical questions or problem-solving scenarios.
- Offer clarifications if the candidate seems unsure about a question.
- Take note of the candidate's strengths and areas for improvement.
- Evaluate both technical skills and soft skills such as communication and problem-solving approach.
After the interview, provide a brief assessment of the candidates performance, highlighting their strengths, areas for improvement, and overall fit for the role.`;

    let systemMessage = {
      role: "system",
      content: systemPrompt,
    };

    messages.push(systemMessage);
  }
}

// Set data sources for chat API
function setDataSources(
  azureCogSearchEndpoint,
  azureCogSearchApiKey,
  azureCogSearchIndexName
) {
  let dataSource = {
    type: "AzureCognitiveSearch",
    parameters: {
      endpoint: azureCogSearchEndpoint,
      key: azureCogSearchApiKey,
      indexName: azureCogSearchIndexName,
      semanticConfiguration: "",
      queryType: "simple",
      fieldsMapping: {
        contentFieldsSeparator: "\n",
        contentFields: ["content"],
        filepathField: null,
        titleField: "title",
        urlField: null,
      },
      inScope: true,
      roleInformation: document.getElementById("prompt").value,
    },
  };

  dataSources.push(dataSource);
}

// Do HTML encoding on given text
function htmlEncode(text) {
  const entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
  };

  return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match]);
}

// Speak the given text
function speak(text, endingSilenceMs = 4) {
  if (isSpeaking) {
    spokenTextQueue.push(text);
    return;
  }

  speakNext(text, endingSilenceMs);
}
function speakFirst(text, endingSilenceMs = 0) {
  if (isSpeaking) {
    spokenTextQueue.push(text);
    return;
  }

  speakNext(text, endingSilenceMs);
  let assistantMessage = {
    role: "assistant",
    content: text,
  };

  messages.push(assistantMessage);
}

function speakNext(text, endingSilenceMs = 0) {
  let ttsVoice = document.getElementById("ttsVoice").value;
  let personalVoiceSpeakerProfileID = document.getElementById(
    "personalVoiceSpeakerProfileID"
  ).value;
  let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:ttsembedding speakerProfileId='${personalVoiceSpeakerProfileID}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(
    text
  )}</mstts:ttsembedding></voice></speak>`;
  if (endingSilenceMs > 4) {
    ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:ttsembedding speakerProfileId='${personalVoiceSpeakerProfileID}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(
      text
    )}<break time='${endingSilenceMs}ms' /></mstts:ttsembedding></voice></speak>`;
  }

  lastSpeakTime = new Date();
  isSpeaking = true;
  document.getElementById("stopSpeaking").disabled = false;
  avatarSynthesizer
    .speakSsmlAsync(ssml)
    .then((result) => {
      if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
        console.log(
          `Speech synthesized to speaker for text [ ${text} ]. Result ID: ${result.resultId}`
        );
        lastSpeakTime = new Date();
      } else {
        console.log(
          `Error occurred while speaking the SSML. Result ID: ${result.resultId}`
        );
      }

      if (spokenTextQueue.length > 0) {
        speakNext(spokenTextQueue.shift());
      } else {
        isSpeaking = false;
        document.getElementById("stopSpeaking").disabled = true;
      }
    })
    .catch((error) => {
      console.log(`Error occurred while speaking the SSML: [ ${error} ]`);

      if (spokenTextQueue.length > 0) {
        speakNext(spokenTextQueue.shift());
      } else {
        isSpeaking = false;
        document.getElementById("stopSpeaking").disabled = true;
      }
    });
}

function stopSpeaking() {
  spokenTextQueue = [];
  avatarSynthesizer
    .stopSpeakingAsync()
    .then(() => {
      isSpeaking = false;
      document.getElementById("stopSpeaking").disabled = true;
      console.log(
        "[" + new Date().toISOString() + "] Stop speaking request sent."
      );
    })
    .catch((error) => {
      console.log("Error occurred while stopping speaking: " + error);
    });
}

function handleUserQuery(userQuery) {
  let chatMessage = {
    role: "user",
    content: userQuery,
  };

  messages.push(chatMessage);
  //let chatHistoryTextArea = document.getElementById('chatHistory')
  let chatUserDiv = document.createElement("div");
  chatUserDiv.classList.add("user");
  chatUserDiv.innerText = userQuery;
  let chatContainer = document.getElementById("chatHistory");
  chatContainer.append(chatUserDiv);
  // if (chatHistoryTextArea.innerHTML !== '' && !chatHistoryTextArea.innerHTML.endsWith('\n\n')) {
  //     chatHistoryTextArea.innerHTML += '\n\n'
  // }

  // chatHistoryTextArea.innerHTML += "User: " + userQuery + '\n\n'
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // Stop previous speaking if there is any
  if (isSpeaking) {
    stopSpeaking();
  }

  // For 'bring your data' scenario, chat API currently has long (4s+) latency
  // We return some quick reply here before the chat API returns to mitigate.
  if (dataSources.length > 0 && enableQuickReply) {
    speak(getQuickReply(), 2000);
  }

  const azureOpenAIEndpoint = "https://swcdaoipocaoa15.openai.azure.com"; //document.getElementById('azureOpenAIEndpoint').value
  const azureOpenAIApiKey = "faaf969f35384d0b82ebe9405dc914da"; //document.getElementById('azureOpenAIApiKey').value
  const azureOpenAIDeploymentName = "gpt_4_32k"; //document.getElementById('azureOpenAIDeploymentName').value

  let url =
    "{AOAIEndpoint}/openai/deployments/{AOAIDeployment}/chat/completions?api-version=2023-06-01-preview"
      .replace("{AOAIEndpoint}", azureOpenAIEndpoint)
      .replace("{AOAIDeployment}", azureOpenAIDeploymentName);
  let body = JSON.stringify({
    messages: messages,
    stream: true,
  });

  if (dataSources.length > 0) {
    url =
      "{AOAIEndpoint}/openai/deployments/{AOAIDeployment}/extensions/chat/completions?api-version=2023-06-01-preview"
        .replace("{AOAIEndpoint}", azureOpenAIEndpoint)
        .replace("{AOAIDeployment}", azureOpenAIDeploymentName);
    body = JSON.stringify({
      dataSources: dataSources,
      messages: messages,
      stream: true,
    });
  }

  let assistantReply = "";
  let toolContent = "";
  let spokenSentence = "";
  let displaySentence = "";

  fetch(url, {
    method: "POST",
    headers: {
      "api-key": azureOpenAIApiKey,
      "Content-Type": "application/json",
    },
    body: body,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Chat API response status: ${response.status} ${response.statusText}`
        );
      }
      let chatUserDiv = document.createElement("div");
      chatUserDiv.classList.add("assistant");

      let chatContainer = document.getElementById("chatHistory");
      chatContainer.append(chatUserDiv);
      // let chatHistoryTextArea = document.getElementById('chatHistory')

      // chatHistoryTextArea.innerHTML += 'Assistant: '

      const reader = response.body.getReader();

      // Function to recursively read chunks from the stream
      function read(previousChunkString = "") {
        return reader.read().then(({ value, done }) => {
          // Check if there is still data to read
          if (done) {
            // Stream complete
            return;
          }

          // Process the chunk of data (value)
          let chunkString = new TextDecoder().decode(value, { stream: true });
          if (previousChunkString !== "") {
            // Concatenate the previous chunk string in case it is incomplete
            chunkString = previousChunkString + chunkString;
          }

          if (
            !chunkString.endsWith("}\n\n") &&
            !chunkString.endsWith("[DONE]\n\n")
          ) {
            // This is a incomplete chunk, read the next chunk
            return read(chunkString);
          }

          chunkString.split("\n\n").forEach((line) => {
            try {
              if (line.startsWith("data:") && !line.endsWith("[DONE]")) {
                const responseJson = JSON.parse(line.substring(5).trim());
                let responseToken = undefined;
                if (dataSources.length === 0) {
                  responseToken = responseJson.choices[0].delta.content;
                } else {
                  let role = responseJson.choices[0].messages[0].delta.role;
                  if (role === "tool") {
                    toolContent =
                      responseJson.choices[0].messages[0].delta.content;
                  } else {
                    responseToken =
                      responseJson.choices[0].messages[0].delta.content;
                    if (responseToken !== undefined) {
                      if (byodDocRegex.test(responseToken)) {
                        responseToken = responseToken
                          .replace(byodDocRegex, "")
                          .trim();
                      }

                      if (responseToken === "[DONE]") {
                        responseToken = undefined;
                      }
                    }
                  }
                }

                if (responseToken !== undefined && responseToken !== null) {
                  assistantReply += responseToken; // build up the assistant message
                  displaySentence += responseToken; // build up the display sentence

                  // console.log(`Current token: ${responseToken}`)

                  if (responseToken === "\n" || responseToken === "\n\n") {
                    speak(spokenSentence.trim());
                    spokenSentence = "";
                  } else {
                    responseToken = responseToken.replace(/\n/g, "");
                    spokenSentence += responseToken; // build up the spoken sentence

                    if (
                      responseToken.length === 1 ||
                      responseToken.length === 2
                    ) {
                      for (
                        let i = 0;
                        i < sentenceLevelPunctuations.length;
                        ++i
                      ) {
                        let sentenceLevelPunctuation =
                          sentenceLevelPunctuations[i];
                        if (
                          responseToken.startsWith(sentenceLevelPunctuation)
                        ) {
                          speak(spokenSentence.trim());
                          spokenSentence = "";
                          break;
                        }
                      }
                    }
                  }
                }
              }
            } catch (error) {
              console.log(
                `Error occurred while parsing the response: ${error}`
              );
              console.log(chunkString);
            }
          });
          chatUserDiv.innerText += `${displaySentence}`;
          // chatHistoryTextArea.innerHTML += `${displaySentence}`
          chatContainer.scrollTop = chatContainer.scrollHeight;
          displaySentence = "";

          // Continue reading the next chunk
          return read();
        });
      }

      // Start reading the stream
      return read();
    })
    .then(() => {
      if (spokenSentence !== "") {
        speak(spokenSentence.trim());
        spokenSentence = "";
      }

      if (dataSources.length > 0) {
        let toolMessage = {
          role: "tool",
          content: toolContent,
        };

        messages.push(toolMessage);
      }

      let assistantMessage = {
        role: "assistant",
        content: assistantReply,
      };

      messages.push(assistantMessage);
    });
}

function getQuickReply() {
  return quickReplies[Math.floor(Math.random() * quickReplies.length)];
}

function checkHung() {
  // Check whether the avatar video stream is hung, by checking whether the video time is advancing
  let videoElement = document.getElementById("videoPlayer");
  if (videoElement !== null && videoElement !== undefined && sessionActive) {
    let videoTime = videoElement.currentTime;
    setTimeout(() => {
      // Check whether the video time is advancing
      if (videoElement.currentTime === videoTime) {
        // Check whether the session is active to avoid duplicatedly triggering reconnect
        if (sessionActive) {
          sessionActive = false;
          if (document.getElementById("autoReconnectAvatar").checked) {
            console.log(
              `[${new Date().toISOString()}] The video stream got disconnected, need reconnect.`
            );
            connectAvatar();
          }
        }
      }
    }, 5000);
  }
}

function checkLastSpeak() {
  if (lastSpeakTime === undefined) {
    return;
  }

  let currentTime = new Date();
  if (currentTime - lastSpeakTime > 15000) {
    if (
      document.getElementById("useLocalVideoForIdle").checked &&
      sessionActive &&
      !isSpeaking
    ) {
      disconnectAvatar();
      document.getElementById("localVideo").hidden = false;
      document.getElementById("remoteVideo").style.width = "0.1px";

      sessionActive = false;
    }
  }
}
window.addEventListener("load", function () {
  window.updateTypeMessageBox();
});
// window.addEventListener('DOMContentLoaded', function() {
//     connectAvatar();
// });
window.onload = () => {
  setInterval(() => {
    checkHung();
    checkLastSpeak();
  }, 5000); // Check session activity every 5 seconds
};

window.startSession = () => {
  if (document.getElementById("useLocalVideoForIdle").checked) {
    document.getElementById("startSession").disabled = true;
    document.getElementById("configuration").hidden = true;
    document.getElementById("microphone").disabled = false;
    document.getElementById("stopSession").disabled = false;
    document.getElementById("localVideo").hidden = false;
    document.getElementById("remoteVideo").style.width = "0.1px";
    document.getElementById("chatHistory").hidden = false;
    document.getElementById("showTypeMessage").disabled = false;
    return;
  }

  connectAvatar();
};

window.stopSession = () => {
  document.getElementById("startSession").disabled = false;
  document.getElementById("microphone").disabled = true;
  document.getElementById("stopSession").disabled = true;
  document.getElementById("configuration").hidden = true;
  document.getElementById("chatHistory").hidden = true;
  document.getElementById("showTypeMessage").checked = false;
  document.getElementById("showTypeMessage").disabled = true;
  document.getElementById("userMessageBox").hidden = true;
  if (document.getElementById("useLocalVideoForIdle").checked) {
    document.getElementById("localVideo").hidden = true;
  }

  disconnectAvatar();
};

window.clearChatHistory = () => {
  document.getElementById("chatHistory").innerHTML = "";
  initMessages();
};

window.microphone = () => {
  // Check if the browser supports WebRTC getUserMedia API
  // requestMicrophone();
 
  document.getElementById('microphone').disabled = false
  if (document.getElementById('microphone').src.includes('emojione-monotone_stop-button.svg')) {
    // Stop microphone
    speechRecognizer.stopContinuousRecognitionAsync(
        () => {
            document.getElementById('microphone').src = './image/Frame 2610372.svg';
            document.getElementById('microphone').disabled = false;
        }, (err) => {
            console.log("Failed to stop continuous recognition:", err);
            document.getElementById('microphone').disabled = false;
        }
    );
    return;
 }

  if (document.getElementById('useLocalVideoForIdle').checked) {
      if (!sessionActive) {
          connectAvatar()
      }

      setTimeout(() => {
          document.getElementById('audioPlayer').play()
      }, 5000)
  } else {
      document.getElementById('audioPlayer').play()
  }


 
  speechRecognizer.recognized = async (s, e) => {
      if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          let userQuery = e.result.text.trim()
          if (userQuery === '') {
              return
          }

          // Auto stop microphone when a phrase is recognized, when it's not continuous conversation mode
          if (!document.getElementById('continuousConversation').checked) {
              document.getElementById('microphone').disabled = true
              speechRecognizer.stopContinuousRecognitionAsync(
                  () => {
                      document.getElementById('microphone').src = './image/Frame 2610372.svg';
                      document.getElementById('microphone').disabled = false
                  }, (err) => {
                      console.log("Failed to stop continuous recognition:", err)
                      document.getElementById('microphone').disabled = false
                  })
          }

          handleUserQuery(userQuery)
      }
  }

  speechRecognizer.startContinuousRecognitionAsync(
      () => {
          document.getElementById('microphone').src = './image/emojione-monotone_stop-button.svg';
          document.getElementById('microphone').disabled = false
      }, (err) => {
          console.log("Failed to start continuous recognition:", err)
          document.getElementById('microphone').disabled = false
      })
}

window.updataEnableOyd = () => {
  if (document.getElementById("enableOyd").checked) {
    document.getElementById("cogSearchConfig").hidden = false;
  } else {
    document.getElementById("cogSearchConfig").hidden = true;
  }
};

window.updateTypeMessageBox = () => {
  //document.getElementById('userMessageBox').hidden = false
  document.getElementById("userMessageBox").addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
      const userQuery = document.getElementById("userMessageBox").value;
      if (userQuery !== "") {
        handleUserQuery(userQuery.trim("\n"));
        document.getElementById("userMessageBox").value = "";
      }
    }
  });
};

window.updateLocalVideoForIdle = () => {
  if (document.getElementById("useLocalVideoForIdle").checked) {
    document.getElementById("showTypeMessageCheckbox").hidden = true;
  } else {
    document.getElementById("showTypeMessageCheckbox").hidden = false;
  }
};

window.updatePrivateEndpoint = () => {
  if (document.getElementById("enablePrivateEndpoint").checked) {
    document.getElementById("showPrivateEndpointCheckBox").hidden = false;
  } else {
    document.getElementById("showPrivateEndpointCheckBox").hidden = true;
  }
};

document.addEventListener('DOMContentLoaded', function() {
  const downloadPdfButton = document.getElementById('downloadPdfButton');
  downloadPdfButton.addEventListener('click', function() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
 
    // Get chat history
    const chatHistory = document.getElementById('chatHistory');
    const chatText = chatHistory.innerText || chatHistory.textContent;
 
    // Set font size and style
    doc.setFont('Arial', 'normal');
    doc.setFontSize(12);
 
    // Define margins
    const margin = 10;
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
 
    // Initialize vertical position
    let yPosition = margin;
 
    // Split text into lines that fit within the page width
    const lines = doc.splitTextToSize(chatText, pageWidth - 2 * margin);
 
    // Add lines to PDF
    lines.forEach(line => {
      if (yPosition + 10 > pageHeight - margin) {
        // Add a new page if the current one is full
        doc.addPage();
        yPosition = margin;
      }
      doc.text(line, margin, yPosition);
      yPosition += 10; // Line height
    });
 
    // Save the PDF
    doc.save('chat_history.pdf');
  });
});
