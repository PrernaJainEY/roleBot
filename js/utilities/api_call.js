async function sample_model(prompt){
    // Define the prompt with clear headings for each task
    prompt=` `
    
  const azureOpenAIEndpoint = "https://swcdaoipocaoa15.openai.azure.com"; 
  const azureOpenAIApiKey = "faaf969f35384d0b82ebe9405dc914da"; 
  const azureOpenAIDeploymentName = "gpt_4_32k";

  let url =
    "{AOAIEndpoint}/openai/deployments/{AOAIDeployment}/chat/completions?api-version=2023-06-01-preview"
      .replace("{AOAIEndpoint}", azureOpenAIEndpoint)
      .replace("{AOAIDeployment}", azureOpenAIDeploymentName);

  let mes = JSON.stringify({
    messages: [{ "role": "system", "content": prompt }],
    stream: false,
  });

  try {
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
    console.log("Response data:", data.choices[0].message.content);

    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
}