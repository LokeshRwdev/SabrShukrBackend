const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const region = process.env.AWS_SES_REGION || process.env.AWS_REGION || 'us-east-1';

const sesClient = new SESClient({ region });

module.exports = {
	sesClient,
	SendEmailCommand,
};


