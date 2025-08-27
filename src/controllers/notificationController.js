// Notification Controller
const supabase = require('../utils/supabaseClient');
const { sesClient, SendEmailCommand } = require('../utils/sesClient');

// GET /api/notifications/:userId
exports.getNotificationsByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    // RLS policies on the 'notifications' table should ensure users only see their own notifications
    // Admins will see all notifications due to their RLS policy.
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ message: 'Failed to fetch notifications.' });
    }
    return res.status(200).json({ notifications });
  } catch (err) {
    next(err);
  }
};

// POST /api/notifications (Admin Only)
exports.createNotification = async (req, res, next) => {
  try {
    const { userId, title, message, link_to } = req.body;

    // Use service role client if inserting for a user different from the current authenticated user
    // or if the RLS policy for insert prevents direct user inserts.
    const { data, error } = await supabase.serviceRole
      .from('notifications')
      .insert({
        user_id: userId,
        title,
        message,
        link_to,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      return res.status(500).json({ message: 'Failed to create notification.' });
    }
    return res.status(201).json({ message: 'Notification created successfully.', notification: data });
  } catch (err) {
    next(err);
  }
}; 

// POST /api/notifications/send-order-email
// Body: { customerEmail: string, orderId: number }
exports.sendOrderNotification = async (req, res, next) => {
  try {
    const { customerEmail, orderId } = req.body || {};
    if (!customerEmail || !orderId) {
      return res.status(400).json({ success: false, message: 'customerEmail and orderId are required' });
    }

    const sourceEmail = process.env.SES_FROM_EMAIL || process.env.FROM_EMAIL;
    if (!sourceEmail) {
      return res.status(500).json({ success: false, message: 'SES_FROM_EMAIL (or FROM_EMAIL) not configured' });
    }

    const subject = `Your Order #${orderId} Confirmation`;
    const htmlBody = `
      <div style="font-family: Arial, sans-serif;">
        <h2>Thank you for your order!</h2>
        <p>Your order <strong>#${orderId}</strong> has been received and is being processed.</p>
        <p>We will notify you when it ships.</p>
        <p>— Sabr Shukr</p>
      </div>
    `;

    const textBody = `Thank you for your order! Your order #${orderId} has been received and is being processed. We will notify you when it ships. — SabrShukr`;

    const params = {
      Source: sourceEmail,
      Destination: { ToAddresses: [customerEmail] },
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: htmlBody, Charset: 'UTF-8' },
          Text: { Data: textBody, Charset: 'UTF-8' },
        },
      },
    };

    const command = new SendEmailCommand(params);
    const response = await sesClient.send(command);

    return res.status(200).json({ success: true, data: { messageId: response?.MessageId } });
  } catch (err) {
    next(err);
  }
};