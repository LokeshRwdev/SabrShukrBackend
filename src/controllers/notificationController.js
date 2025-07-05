// Notification Controller
const supabase = require('../utils/supabaseClient');

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