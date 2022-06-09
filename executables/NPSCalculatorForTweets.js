const program = require('commander');

/**
 * Script to update expiry time for packages.
 *
 * @module executables/NPSCalculatorForTweets
 */

const rootPrefix = '..',
  GetMentionedTweetsForUserLib = require(rootPrefix + '/lib/Twitter/GetMentionedTweetsForUser'),
  GetSentimentsFromAWSComprehend = require(rootPrefix + '/lib/awsComprehend/GetSentiments'),
  GetSentimentsFromGoogleNLP = require(rootPrefix + '/lib/googleNLP/GetSentiments'),
  GenerateTweetsAndSentimentsCSV = require(rootPrefix + '/lib/report/TweetSentiments'),
  NPSCalculatorLib = require(rootPrefix + '/lib/NPSCalculator');

program.allowUnknownOption();
program.option('--startTime <startTime>', 'Start Timestamp').parse(process.argv);
program.option('--endTime <endTime>', 'End Timestamp').parse(process.argv);
program.option('--csvRequired <csvRequired>', 'CSV required(1/0)').parse(process.argv);

program.on('--help', function() {
  console.log('');
  console.log('  Example:');
  console.log('');
  console.log(' node executables/NPSCalculatorForTweets --startTime 1654759307 --endTime 1654413707 --csvRequired 1');
  console.log('');
});

const startTime = program.opts().startTime,
  endTime = program.opts().endTime,
  csvRequired = program.opts().csvRequired;

if (!startTime || !endTime || !csvRequired) {
  program.help();
  process.exit(1);
}

class NPSCalculatorForTweets {
  /**
   * Constructor
   */
  constructor(params) {
    const oThis = this;

    oThis.startTime = params.startTime;
    oThis.endTime = params.endTime;
    oThis.csvRequired = params.csvRequired;

    oThis.allTweetsInDuration = [];
    oThis.sentimentsFromAWSComprehend = [];
    oThis.sentimentsFromGoogleNLP = [];

    oThis.batchTweets = [];
    oThis.batchSentimentsForAWSComprehend = [];
    oThis.batchSentimentsFromGoogleNLP = [];

    oThis.twitterRequestMeta = {};
    oThis.processNextIteration = null;

    oThis.npsCalculationResponse = {};
  }

  /**
   * Perform
   *
   * @returns {Promise<void>}
   */
  async perform() {
    const oThis = this;

    oThis.processNextIteration = true;

    while (oThis.processNextIteration) {
      oThis.batchTweets = [];
      oThis.batchSentimentsForAWSComprehend = [];
      oThis.batchSentimentsFromGoogleNLP = [];

      await oThis._getTweetsForUser();

      if (oThis.batchTweets.length == 0) {
        console.log(' --- No more tweets to process --- ');
        break;
      }

      await oThis._getSentimentAnalysisUsingAwsComprehend();

      await oThis._getSentimentAnalysisUsingGoogleNLP();

      oThis.allTweetsInDuration = oThis.allTweetsInDuration.concat(oThis.batchTweets);
      oThis.sentimentsFromAWSComprehend = oThis.allTweetsInDuration.concat(oThis.batchSentimentsForAWSComprehend);
      oThis.sentimentsFromGoogleNLP = oThis.allTweetsInDuration.concat(oThis.batchSentimentsFromGoogleNLP);
    }

    await oThis._calculateNPS();

    await oThis._writeDataToCsv();

    process.exit(0);
  }

  /**
   * Get Tweets for user.
   *
   * @sets oThis.batchTweets, oThis.processNextIteration
   *
   * @returns {Promise<void>}
   * @private
   */
  async _getTweetsForUser() {
    const oThis = this;

    const params = {
      twitterUserId: '1519609900564992004', // plgworks twitter user id
      maxResults: 5,
      startTime: oThis.startTime,
      endTime: oThis.endTime
    };

    if (oThis.twitterRequestMeta.next_token) {
      params.paginationToken = oThis.twitterRequestMeta.next_token;
    }

    const tweetsLibResponse = await new GetMentionedTweetsForUserLib(params).perform().catch(function(err) {
      console.log('Error while Fetching Tweets :: --------- ', err);
    });

    oThis.batchTweets = (tweetsLibResponse && tweetsLibResponse.data) || [];
    oThis.twitterRequestMeta = (tweetsLibResponse && tweetsLibResponse.meta) || {};

    if (!oThis.twitterRequestMeta.next_token) {
      oThis.processNextIteration = false;
    }
  }

  /**
   * Get Sentiment Analysis Using AwsComprehend
   *
   * @sets oThis.batchSentimentsForAWSComprehend, oThis.sentimentsFromAWSComprehend
   * @returns {Promise<void>}
   * @private
   */
  async _getSentimentAnalysisUsingAwsComprehend() {
    const oThis = this;

    const sentimentsFromAWSComprehend = await new GetSentimentsFromAWSComprehend(oThis.batchTweets)
      .perform()
      .catch(function(err) {
        console.log('Error while Fetching sentiments from Aws Comprehend :: --------- ', err);
      });

    if (sentimentsFromAWSComprehend.length !== 0) {
      oThis.batchSentimentsForAWSComprehend = sentimentsFromAWSComprehend;
    }

    console.log('sentimentsFromAWSComprehend ================', oThis.batchSentimentsForAWSComprehend);
  }

  /**
   * Get Sentiment Analysis Using Google NLP
   *
   * @sets oThis.batchSentimentsFromGoogleNLP, oThis.sentimentsFromGoogleNLP
   *
   * @returns {Promise<void>}
   * @private
   */
  async _getSentimentAnalysisUsingGoogleNLP() {
    const oThis = this;

    const sentimentsFromGoogleNLP = await new GetSentimentsFromGoogleNLP(oThis.batchTweets)
      .perform()
      .catch(function(err) {
        console.log('Error while Fetching sentiments from Google NLP :: --------- ', err);
      });

    if (sentimentsFromGoogleNLP.length !== 0) {
      oThis.batchSentimentsFromGoogleNLP = sentimentsFromGoogleNLP;
    }

    console.log('sentimentsFromGoogleNLP ================', oThis.batchSentimentsFromGoogleNLP);
  }

  /**
   * Calculate NPS for tweets
   *
   * @sets oThis.npsCalculationResponse
   *
   * @returns {Promise<void>}
   * @private
   */
  async _calculateNPS() {
    const oThis = this;

    const totalTweets = Number(oThis.allTweetsInDuration.length);

    oThis.npsCalculationResponse = await new NPSCalculatorLib(
      oThis.sentimentsFromAWSComprehend,
      oThis.sentimentsFromGoogleNLP,
      totalTweets
    ).perform();
  }

  async _writeDataToCsv() {
    const oThis = this;

    if (oThis.csvRequired) {
      const params = {
        tweets: oThis.allTweetsInDuration,
        sentimentsFromAWSComprehend: oThis.sentimentsFromAWSComprehend,
        sentimentsFromGoogleNLP: oThis.sentimentsFromGoogleNLP
      };

      return new GenerateTweetsAndSentimentsCSV(params).perform();
    }
  }
}

const performer = new NPSCalculatorForTweets({
  startTime: startTime,
  endTime: endTime,
  csvRequired: csvRequired
});

performer.perform().then(function(r) {
  console.log('Before exit:', r);
  process.exit(0);
});
