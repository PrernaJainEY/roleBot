// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var messages = [];
var evaluationmessages = [];
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
  console.log("I am in Connect Avatar");
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
    try
      {initMessages();
      }catch(e){
        console.log("Error in init msg",e);
      }
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
        // document.getElementById("microphoneButton1").style.display = "flex";
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

// const currentUrl = window.location.href;
// console.log(currentUrl); // This will log the current URL

// // Define your Excel files
// const excelFiles = ['CompetencySample_JKLC_test.xlsx', 'RoletoCompJKLC_test.xlsx', 'role_based_admin_input_test.xlsx']; // Add more as needed

// // Function to fetch Excel file
// async function fetchExcelFile(file) {
//   try {
//       const fileUrl = `${currentUrl}js/master/${file}`;
//       const response = await fetch(fileUrl);
      
//       if (!response.ok) {
//           throw new Error('Network response was not ok');
//       }

//       const arrayBuffer = await response.arrayBuffer();
//       const workbook = XLSX.read(arrayBuffer, { type: 'array' });
//       const firstSheetName = workbook.SheetNames[0];
//       const worksheet = workbook.Sheets[firstSheetName];
//       const json = XLSX.utils.sheet_to_json(worksheet);

//       console.log(JSON.stringify(json, null, 2));
//   } catch (error) {
//       console.error('Error fetching the Excel file:', error);
//   }
// }

// // Loop through Excel files and fetch each one
// for (const file of excelFiles) {
//    fetchExcelFile(file);
// }

function initMessages() {
const text_area_job=""
  const key_focus_area=
    document.getElementById("key_focus_area").value ||
     `Sales Strategy: Develop and implement territory-specific sales strategies
Customer Relations: Build and maintain strong relationships with existing and new customers.
Sales Execution: Conduct presentations, negotiate deals, and close sales.
Territory Management: Plan coverage, segment customers, and track performance.
Team Collaboration: Coordinate with internal teams and support junior members.
Market Intelligence: Monitor competitors and gather market feedback.
Administrative Duties: Maintain records and ensure policy compliance.`;
const prompt =
document.getElementById("prompt").value || 
`As a new Territory Sales Manager, what will you do differently that your predecessors couldn't achieve? 
•  You've appointed a new dealer in my area, my business is at risk! How do you plan to address this issue? 
•  What's your strategy to tackle the undercutting problem in the market? How will you ensure we don't all go bankrupt due to this practice? 
•  My payments have been pending for 6 months, and my cash flow is breaking down. How will you resolve this situation? 
•  These substandard gifts for the contractor scheme are not appreciated, it's reducing our reputation. How will you address this feedback? 
•  I can't understand this ledger. Are you trying to fool us? How can you make this more transparent? 
•  We always face problems with GST filing due to late credit notes. How will you solve this recurring issue? 
•  These discount calculations seem incorrect, we're incurring losses. How will you make these calculations more transparent and understandable? 
•  We used to handle everything in cash before, this new FOR delivery system is causing problems. How do you justify these changes? 
•  You people only know how to sell, there's no marketing support! How do you plan to improve marketing support? 
•  Old branding is still displayed at my location. Are we not important enough? What's your plan to update the branding? 
•  In every truck, at least two cement bags are damaged. Who will bear this loss? 
•  The margin is so low that damages alone wipe out all our profit. How will you address this concern? 
•  Technical services don't provide any solutions. What answer should we give to customers? What action plan do you have? 
•  You've reduced the rates, how will we survive now? How can you reassure us about our profitability? 
•  You're supplying directly to retailers, what's the need for us then? How will you handle this situation? 
•  You only visit once in two months, whom should we talk to about our problems? How will you bridge this communication gap? 
•  You provide credit notes with GST, but we have to take input. What's this complication? Can you explain this simply? 
•  I've been working exclusively for so many years, but there's no special discount for me. How will you reward loyalty? 
•  The sales promoter doesn't do anything but eats into the commission for my hard work! How will you change this perception?`;
  const ai_persona =
    document.getElementById("ai_persona").value ||
    `Amit Shah (Cement sales Dealer) : 45-year-old owner of Patel Building Materials in Ahmedabad, Gujarat, with 20 years of experience and ₹15-20 crore annual turnover. Sells various construction materials, primarily "IndiaStrong Cement", aiming to increase turnover to ₹25 crore and improve profit margins from 8% to 12%. Strengths: strong local relationships, reliable service, deep product knowledge; Challenges: cash flow management, intense competition, fluctuating cement prices. Seeks consistent product quality, competitive pricing, and marketing support from cement companies; prefers direct communication and face-to-face meetings for important discussions. Tech-savvy with basic software use, but cautious about advanced digital tools; actively involved in daily operations from site visits to inventory management and client meetings. Decision factors: profit margin, payment terms, brand reputation, product quality, and support from cement companies.`;
  const employee_persona =
    document.getElementById("employee_persona").value ||
    `Rajesh Kumar, an experienced Territory Sales Manager in Ahmedabad, runs Kumar Building Supplies with an annual turnover of ₹15-20 crore and aims to grow it to ₹25 crore while improving profit margins from 8% to 12%. He excels in maintaining local relationships and has deep product knowledge. Challenges include cash flow management and intense competition. Rajesh values consistent quality, competitive pricing, and strong marketing support. He prefers direct communication and is hands-on in daily operations.`;
const industry_role =
    document.getElementById("industry_role").value ||
    `Territory Sales Manager`;
const selected_lang =
    document.getElementById("selected_lang").value ||
    `English`;

  if (dataSources.length === 0) {
   let role_play= Role_Play(ai_persona,employee_persona,industry_role,text_area_job,prompt)
    let systemPrompt = 
    `You are an {ai_persona} tasked with conducting a natural, engaging and adaptive Role Play exercise. Understand the inputs from Roles and Context:
    - Role A (AI Bot): ${ai_persona}
    - Role B (Employee): ${employee_persona}
    - Industry/Sector: ${industry_role}
    - Job Description for Role B: ${text_area_job}
    - Language : ${selected_lang}
 
    Please follow the detailed instructions while having this conversation.
    1. Ask only **one clear and concise question** at a time, ensuring it is clear and related to the context provided.
    2. Adopt the persona of Role A, including their communication style, expertise, and industry knowledge. Integrate the persona and role context seamlessly into the conversation.
    3. Before starting the conversation, extract the relevant context and information from ${role_play} for conversation scenarios. This should guide the direction and focus of your interaction.
    4. Ensure the conversation is dynamic, with follow-up questions and discussions based on the employee's responses.
    5. Create and present realistic scenarios, complex conditions, and adaptive conversations based on the given context, roles, and job description.
    6. Ask probing questions and respond to the employee's (Role B) answers in a way that allows them to demonstrate their skills and knowledge naturally.
    7. Don't skip questions or topics; address each point thoroughly.
    8. As the conversation progresses, introduce new information, challenges, or scenarios to make the discussion more dynamic and realistic.
    9. Maintain a balanced approach in your responses. While acknowledging good ideas, also express concerns, challenges, or conflicting objectives where appropriate.
    10. Ensure the conversation covers most of the expected role responsibilities as outlined in the job description.
    11. Conduct a comprehensive conversation that thoroughly explores the main objective and related aspects.
    12. Adapt your responses and the conversation's difficulty based on the employee's answers to create a dynamic and challenging interaction.
 
    **Remember to maintain a natural, human-like conversation throughout the interaction while providing a comprehensive and engaging discussion experience, and ensure you follow the conversation in ${selected_lang} throughout the interaction.**
 
    Note:
    - Strictly follow: Once you receive five answers or if the conversation is closed,say 'Thank you for the insightful discussion!' and end the conversation.
    - If the conversation is not yet closed and five responses have been received, respond with the closing message and end the interaction.
    - If an out-of-context question is detected, respond with:
        "Let's focus on the case study to ensure an accurate assessment of your proficiency in {competency_data_columns['Competency']}. Please refer to the scenario provided."
    - **If the user repeats a question or pastes the question back, respond with:**
        "Please provide your response to the question. Let's focus on the case study and the specific scenario provided.`;

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
  evaluationmessages.push(chatMessage);
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
  console.log("messages", messages)
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
  console.log("Session Starteddddddddddddddd");
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

async function Role_Play(ai_persona,employee_persona,industry,text_area_job,text_area_content){
    // Define the prompt with clear headings for each task
    prompt_role=`

    # You are an  industry expert ${industry} with 25 years of experience, tasked with generating relevant context and scenarios for a role-play conversation, focusing on conflicting objectives and competency assessment.
    # Your output will be processed by another LLM to conduct the actual conversation. Please follow these instructions carefully:

    ## Information Extraction:
    1. Analyze the ${text_area_content} provided by the user.
    2. Extract key details about:
    - Role A:${ai_persona} 
    - Role B (Employee to be assessed): ${employee_persona}
    
    3. Identify key responsibilities for Role B and the main competencies to be assessed (e.g., relationship management, negotiation skills, communication, problem-solving, analytical thinking).

    ## Context Creation:
    1. Develop a clear, concise background for the role-play conversation.
    2. Include the objectives of both roles, ensuring they have some conflicting elements.

    ## Scenario Generation:
    1. Create 3-5 specific scenarios that highlight conflicting objectives between Role A and Role B.
    2. Ensure scenarios are realistic, relevant to the roles and industry, and designed to assess specific competencies.
    3. Include a mix of routine situations and more complex or challenging scenarios.

    ## Conversation Starters:
    1. Provide 2-3 potential conversation starters for the AI Bot (Role A) to initiate the role-play.
    2. Ensure these starters are natural and aligned with the given context and scenarios.

    ## Key Discussion Points:
    1. List 5-7 key topics or responsibilities that should be covered during the conversation.
    2. Link each point to specific competencies to be assessed.

    ## Challenging Elements:
    1. Suggest 2-3 complex problems or decisions that could be introduced during the role-play.
    2. Ensure these challenges involve conflicting objectives and assess multiple competencies.

    ## Output Format:
    1. Context Summary (2-3 sentences, including role objectives)
    2. Scenarios (3-5 bullet points, each including conflicting objectives and competencies to assess)
    3. Conversation Starters (2-3 examples)
    4. Key Discussion Points (5-7 bullet points, each with associated competencies)
    5. Challenging Elements (2-3 bullet points, each with conflicting objectives and competencies to assess)

    ## Remember:
    - Maintain objectivity and avoid personal biases.
    - Do not add information beyond what is provided in the {text_area_content}.
    - Ensure all generated content is directly relevant to the roles, industry, and competencies specified.
    - If any information is ambiguous or unclear, note this in your response.
    
    Your goal is to provide a comprehensive framework that enables a realistic and effective role-play conversation for assessing an employee's capabilities, with a focus on handling conflicting objectives and demonstrating key competencies.

            `
    
    // // Send the prompt to the model
    // response = client_4o.chat.completions.create(
    //     model=gpt_model_4o,
    //     messages=[{"role": "system", "content": prompt_role}],
    //     temperature=0.4
    // )
    // return response.choices[0].message.content
  const azureOpenAIEndpoint = "https://swcdaoipocaoa15.openai.azure.com"; 
  const azureOpenAIApiKey = "faaf969f35384d0b82ebe9405dc914da"; 
  const azureOpenAIDeploymentName = "gpt_4_32k";

  let url =
    "{AOAIEndpoint}/openai/deployments/{AOAIDeployment}/chat/completions?api-version=2023-06-01-preview"
      .replace("{AOAIEndpoint}", azureOpenAIEndpoint)
      .replace("{AOAIDeployment}", azureOpenAIDeploymentName);

  let mes = JSON.stringify({
    messages: [{ "role": "system", "content": prompt_role }],
    stream: false,
  });

  try {
    // First API request to get the role play prompt
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": azureOpenAIApiKey,
        "Content-Type": "application/json",
      },
      body: mes,
    });

    if (!response.ok) {
      throw new Error(`Chat API response status: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Response data Roleplayyyyyyyyyyyyyyyy:", data.choices[0].message.content);

    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error fetching Roleplay:", error);
    throw error;
  }
  }
async function fetchEvaluation(aiPersona, employeePersona, industryRole, prompt_role, chatText) {
  const azureOpenAIEndpoint = "https://swcdaoipocaoa15.openai.azure.com"; 
  const azureOpenAIApiKey = "faaf969f35384d0b82ebe9405dc914da"; 
  const azureOpenAIDeploymentName = "gpt_4_32k";
  const progressBar = document.getElementById('progressBar');
  progressBar.style.display = 'block';

  let url =
    "{AOAIEndpoint}/openai/deployments/{AOAIDeployment}/chat/completions?api-version=2023-06-01-preview"
      .replace("{AOAIEndpoint}", azureOpenAIEndpoint)
      .replace("{AOAIDeployment}", azureOpenAIDeploymentName);

  let mes = JSON.stringify({
    messages: [{ "role": "system", "content": prompt_role }],
    stream: false,
  });

  try {
    // First API request to get the role play prompt
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": azureOpenAIApiKey,
        "Content-Type": "application/json",
      },
      body: mes,
    });

    if (!response.ok) {
      throw new Error(`Chat API response status: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Response data:", data);

    const role_play_prompt = data.choices[0].message.content;
    console.log("Response data:", data);
    
    // Now use the role_play_prompt to generate the evaluation report
    const prompt_role_eval = `
        # Deep Industry Expertise Assessment
        ## Context
        - **Role A**: An AI BOT representing ${aiPersona}
        - **Role B**: An employee being assessed, representing ${employeePersona}
        - **Industry/Sector**: ${industryRole}
        - **Context**: ${role_play_prompt}

        ## Conversation Transcript
        ${chatText}

        ## Assessment

        ### Factor Scores
        1. **Technical Expertise**: [score]
        - Justification: [justification]
        
        2. **Communication and Interpersonal Skills**: [score]
        - Justification: [justification]
        
        3. **Problem-Solving and Decision Making**: [score]
        - Justification: [justification]
        
        4. **Role-Specific Responsibility Execution**: [score]
        - Justification: [justification]
        
        5. **Adaptability and Growth Potential**: [score]
        - Justification: [justification]

        ### Overall Score
        - **Weighted Average Score**: [overall_score] (out of 5)

        ### Top 2 Strengths
        1. **Strength 1**: [specific example from conversation]
        - Explanation: [2-3 sentences]
        
        2. **Strength 2**: [specific example from conversation]
        - Explanation: [2-3 sentences]

        ### Top 2 Areas for Improvement
        1. **Area for Improvement 1**: [specific example from conversation]
        - Suggestions: [2-3 sentences]
        
        2. **Area for Improvement 2**: [specific example from conversation]
        - Suggestions: [2-3 sentences]

        ### Key Observation
        - **Notable Aspect**: [one sentence summary of the most notable aspect of the employee's performance]

        ### Role Readiness Assessment
        - **Readiness**: [Not Ready / Needs Significant Development / Approaching Readiness / Ready / Exceeds Readiness]

        ### Evaluation Rationale
        - **Reasoning**: [3-4 sentences explaining the scores, strengths, areas for improvement, and role readiness assessment]

        ### AI-Generated Content Flag
        - **Instances of Potential AI-Generated Content**: 
        - **Example 1**: [specific example and reasoning]
        - **Example 2**: [specific example and reasoning]

        ## Additional Guidelines
        - Assessment is based strictly on observable behaviors and responses in the transcript.
        - Scores and evaluations are quantifiable, avoiding subjective language.
        - Complexity of scenarios and employee’s handling are considered.
        - Feedback is specific, actionable, and aligned with role performance.
        - AI-generated content flagged based on inconsistencies, verbosity, and lack of human conversational flow.

        ## Conclusion
        The assessment is thorough, objective, and based solely on the conversation transcript and provided context, ensuring a fair and consistent evaluation aligned with industry standards.
    `;

    let prompt_role_eval_body = JSON.stringify({
      messages: [{ "role": "system", "content": prompt_role_eval
 }],
      stream: false,
    });

    // Second API request to get the evaluation report
    const evalResponse = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": azureOpenAIApiKey,
        "Content-Type": "application/json",
      },
      body: prompt_role_eval_body,
    });

    if (!evalResponse.ok) {
      throw new Error(`Chat API response status: ${evalResponse.status} ${evalResponse.statusText}`);
    }

    const prompt_role_eval_data = await evalResponse.json();
    console.log("Evaluation response data:", prompt_role_eval_data);

    // Return the generated evaluation report
    return prompt_role_eval_data.choices[0].message.content;

  } catch (error) {
    console.error("Error fetching evaluation:", error);
    throw error;
  }
  finally {
    // Hide the progress bar after PDF generation
    const progressBar = document.getElementById('progressBar');
    progressBar.style.display = 'none';
  }
}


// Function to generate PDF from evaluation data
function generatePDF(content) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Set font size and style
  doc.setFont('Arial', 'normal');
  doc.setFontSize(12);

  // Define margins
  const margin = 10;
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  // Initialize vertical position
  let yPosition = margin;

  // Split content into lines that fit within the page width
  const lines = doc.splitTextToSize(content, pageWidth - 2 * margin);

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

  const pdfData = doc.output('datauristring');
  
  // Store the base64 string in localStorage
  localStorage.setItem('pdfData', pdfData);
  window.location.href = 'summary.html';
}

document.addEventListener('DOMContentLoaded', (event) => {
  // Event listener for Role Play Evaluation button
  document.getElementById('rolePlayEvalButton').addEventListener('click', async function() {
    try {
      // Collect the data from the form
  const aiPersona =
    document.getElementById("ai_persona").value ||
    `Amit Shah (Cement sales Dealer) : 45-year-old owner of Patel Building Materials in Ahmedabad, Gujarat, with 20 years of experience and ₹15-20 crore annual turnover. Sells various construction materials, primarily "IndiaStrong Cement", aiming to increase turnover to ₹25 crore and improve profit margins from 8% to 12%. Strengths: strong local relationships, reliable service, deep product knowledge; Challenges: cash flow management, intense competition, fluctuating cement prices. Seeks consistent product quality, competitive pricing, and marketing support from cement companies; prefers direct communication and face-to-face meetings for important discussions. Tech-savvy with basic software use, but cautious about advanced digital tools; actively involved in daily operations from site visits to inventory management and client meetings. Decision factors: profit margin, payment terms, brand reputation, product quality, and support from cement companies.`;
  const employeePersona =
    document.getElementById("employee_persona").value ||
    `Rajesh Kumar, an experienced Territory Sales Manager in Ahmedabad, runs Kumar Building Supplies with an annual turnover of ₹15-20 crore and aims to grow it to ₹25 crore while improving profit margins from 8% to 12%. He excels in maintaining local relationships and has deep product knowledge. Challenges include cash flow management and intense competition. Rajesh values consistent quality, competitive pricing, and strong marketing support. He prefers direct communication and is hands-on in daily operations.`;
const industryRole =
    document.getElementById("industry_role").value ||
    `Territory Sales Manager`;

      // Ensure there's valid content in chat history
      const chatHistory = document.getElementById('chatHistory');
      const chatText = chatHistory.innerText || chatHistory.textContent;

      if (!chatText) {
        console.error("No conversation found in chat history.");
        return;
      }

      console.log("Chat Text:", chatText);

      prompt_role=`

      # You are an  industry expert ${industryRole} with 25 years of experience, tasked with generating relevant context and scenarios for a role-play conversation, focusing on conflicting objectives and competency assessment.
      # Your output will be processed by another LLM to conduct the actual conversation. Please follow these instructions carefully:
  
      ## Information Extraction:
      1. Analyze the ${chatText} provided by the user and the bot.
      2. Extract key details about:
      - Role A:${aiPersona} 
      - Role B (Employee to be assessed): ${employeePersona}
      
      3. Identify key responsibilities for Role B and the main competencies to be assessed (e.g., relationship management, negotiation skills, communication, problem-solving, analytical thinking).
  
      ## Context Creation:
      1. Develop a clear, concise background for the role-play conversation.
      2. Include the objectives of both roles, ensuring they have some conflicting elements.
  
      ## Scenario Generation:
      1. Create 3-5 specific scenarios that highlight conflicting objectives between Role A and Role B.
      2. Ensure scenarios are realistic, relevant to the roles and industry, and designed to assess specific competencies.
      3. Include a mix of routine situations and more complex or challenging scenarios.
  
      ## Conversation Starters:
      1. Provide 2-3 potential conversation starters for the AI Bot (Role A) to initiate the role-play.
      2. Ensure these starters are natural and aligned with the given context and scenarios.
  
      ## Key Discussion Points:
      1. List 5-7 key topics or responsibilities that should be covered during the conversation.
      2. Link each point to specific competencies to be assessed.
  
      ## Challenging Elements:
      1. Suggest 2-3 complex problems or decisions that could be introduced during the role-play.
      2. Ensure these challenges involve conflicting objectives and assess multiple competencies.
  
      ## Output Format:
      1. Context Summary (2-3 sentences, including role objectives)
      2. Scenarios (3-5 bullet points, each including conflicting objectives and competencies to assess)
      3. Conversation Starters (2-3 examples)
      4. Key Discussion Points (5-7 bullet points, each with associated competencies)
      5. Challenging Elements (2-3 bullet points, each with conflicting objectives and competencies to assess)
  
      ## Remember:
      - Maintain objectivity and avoid personal biases.
      - Do not add information beyond what is provided within the context ${chatText}.
      - Ensure all generated content is directly relevant to the roles, industry, and competencies specified.
      - If any information is ambiguous or unclear, note this in your response.
      
      Your goal is to provide a comprehensive framework that enables a realistic and effective role-play conversation for assessing an employee's capabilities, with a focus on handling conflicting objectives and demonstrating key competencies.`

      // Send the evaluation prompt to the backend (or API)
      const evaluationContent = await fetchEvaluation(aiPersona, employeePersona, industryRole, prompt_role, chatText);
      
      // Check if the evaluation content was generated successfully
      if (!evaluationContent) {
        throw new Error("Failed to fetch the evaluation content");
      }
      console.log("evaluationContent", evaluationContent)

      // Generate the PDF report based on the content
      generatePDF(evaluationContent);

    } catch (error) {
      console.error("Failed to generate evaluation report:", error);
    }
  });
});









