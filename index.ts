import { Context, APIGatewayEvent } from 'aws-lambda';
import * as cheerio from 'cheerio';

// Schemas defined by AWS for the Lambda function
// https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html

interface BedrockAgentLambdaEvent extends APIGatewayEvent {
  function: string;
  parameters: any[];
  actionGroup: string;
}

interface BedrockResult {
  messageVersion: string;
  response: {
    actionGroup: string;
    function: string;
    functionResponse: {
      responseState?: string;
      responseBody: any;
    }
  }
}

export const handler = async (event: BedrockAgentLambdaEvent, context: Context): Promise<BedrockResult> => {
  let agentFunction = event['function'];
  let parameters = event['parameters'];

  let actionResponse = {
    'messageVersion': '1.0',
    'response': {
      'actionGroup': event['actionGroup'] || '',
      'function': event['function'] || '',
      'functionResponse': {
        'responseBody': {
          'TEXT': {
            'body': '',
          }
        }
      }
    }
  };

  if (agentFunction === 'scrape') {
    // get URL from parameters
    let url = parameters.find(param => param.name === 'url')?.value || '';

    if (!url) {
      actionResponse['response']['functionResponse']['responseState'] = 'FAILURE';
      actionResponse['response']['functionResponse']['responseBody']['TEXT']['body'] = JSON.stringify({
        'error': 'URL not found in parameters',
      });
      return actionResponse;
    }

    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    // Remove extraneous elements
    $('script, style, iframe, noscript, link, meta, head, comment').remove();

    let plainText = $('body').text();
    console.log({plainText});

    // Limit of Lambda response payload is 25KB
    // https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html
    const maxSizeInBytes = 20 * 1024;
    if (Buffer.byteLength(plainText, 'utf8') > maxSizeInBytes) {
      while (Buffer.byteLength(plainText, 'utf8') > maxSizeInBytes) {
        plainText = plainText.slice(0, -1);
      }
      plainText = plainText.trim() + '...'; // Add an ellipsis to indicate truncation
    }
    console.log({plainText});
    
    actionResponse['response']['functionResponse']['responseBody']['TEXT']['body'] = JSON.stringify({
      'text': plainText,
    });
    return actionResponse;

  } else if (agentFunction === 'google_search') {
    let query = parameters.find(param => param.name === 'query')?.value || '';

    if (!query) {
      actionResponse['response']['functionResponse']['responseState'] = 'FAILURE';
      actionResponse['response']['functionResponse']['responseBody']['TEXT']['body'] = JSON.stringify({
        'error': 'Query not found in parameters',
      });
      return actionResponse;
    }

    const googleParams = {
      key: process.env.GOOGLE_SEARCH_KEY,
      cx: process.env.GOOGLE_SEARCH_CX,
      q: query,
    };

    const queryString = Object.keys(googleParams)
      .map(key => key + '=' + googleParams[key])
      .join('&');

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${queryString}`);
    const data = await response.json();

    if (data.items) {
      // only return title and link of first 10 results for smaller response payload
      const results = data.items.map((item: any) => {
        return {
          title: item.title,
          link: item.link,
        };
      }).slice(0, 10);

      actionResponse['response']['functionResponse']['responseBody']['TEXT']['body'] = JSON.stringify({
        'results': results,
      });
      return actionResponse;
    } else {
      actionResponse['response']['functionResponse']['responseState'] = 'FAILURE';
      actionResponse['response']['functionResponse']['responseBody']['TEXT']['body'] = JSON.stringify({
        'error': 'No results found',
      });
      return actionResponse;
    }
  } else {
    actionResponse['response']['functionResponse']['responseState'] = 'FAILURE';
    actionResponse['response']['functionResponse']['responseBody']['TEXT']['body'] = JSON.stringify({
      'error': 'Function not found',
    });
    return actionResponse;
  }
};