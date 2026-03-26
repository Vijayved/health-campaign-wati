const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ==================== MongoDB Connection ====================
console.log('🔌 Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err.message));

// ==================== Lead Schema ====================
const leadSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  name: { type: String, default: '' },
  branch: { type: String, default: 'Usmanpura' },
  testType: { type: String, default: '' },
  testDetails: { type: String, default: '' },
  executiveAssigned: { type: String, default: '' },
  executivePhone: { type: String, default: '' },
  status: {
    type: String,
    enum: ['new', 'assigned', 'converted', 'waiting', 'not_converted'],
    default: 'new'
  },
  source: { type: String, default: 'WATI_Campaign' },
  campaign: { type: String, default: 'health_checkup' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Lead = mongoose.model('Lead', leadSchema);

// ==================== Executive Configuration ====================
const executives = [
  { name: 'Aditi', phone: '8488931212', whatsapp: '8488931212', active: true, leadCount: 0 },
  { name: 'Khyati', phone: '7490029085', whatsapp: '7490029085', active: true, leadCount: 0 },
  { name: 'Jay', phone: '9274682553', whatsapp: '9274682553', active: true, leadCount: 0 },
  { name: 'Mital', phone: '9558591212', whatsapp: '9558591212', active: true, leadCount: 0 }
];

let currentExecutiveIndex = 0;

function getNextExecutive() {
  const activeExecs = executives.filter(e => e.active);
  if (activeExecs.length === 0) return null;
  const exec = activeExecs[currentExecutiveIndex % activeExecs.length];
  currentExecutiveIndex++;
  return exec;
}

// ==================== WATI API Configuration ====================
const WATI_BASE_URL = process.env.WATI_API_URL || 'https://live-mt-server.wati.io';
const WATI_API_KEY = process.env.WATI_API_KEY;

// CORRECTED: Send WhatsApp Template Message (WATI v1 Format with phone in URL)
async function sendWatiTemplate(phoneNumber, templateName, params = []) {
  try {
    // Clean phone: ensure 91 prefix without +
    const cleanPhone = phoneNumber.startsWith('91') ? phoneNumber : `91${phoneNumber}`;
    
    // Correct WATI API endpoint with phone in URL
    const url = `${WATI_BASE_URL}/api/v1/sendTemplateMessages?phone=${cleanPhone}`;
    
    // Format parameters as object (not array)
    const parameters = {};
    params.forEach(p => {
      parameters[p.name] = p.value;
    });
    
    const payload = {
      template_name: templateName,
      broadcast_name: `Health_Campaign_${Date.now()}`,
      parameters: parameters
    };
    
    console.log(`📤 Sending template to ${cleanPhone}:`);
    console.log(`   Template: ${templateName}`);
    console.log(`   Params:`, JSON.stringify(parameters, null, 2));
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Template sent successfully to ${cleanPhone}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send template to ${phoneNumber}:`);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// Send Text Message (Session Message)
async function sendWatiText(phoneNumber, text) {
  try {
    const cleanPhone = phoneNumber.startsWith('91') ? phoneNumber : `91${phoneNumber}`;
    const url = `${WATI_BASE_URL}/api/v1/sendSessionMessage/${cleanPhone}`;
    const payload = { text };
    
    console.log(`📤 Sending text to ${cleanPhone}:`);
    console.log(`   Message: ${text.substring(0, 100)}...`);
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': WATI_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Text sent successfully to ${cleanPhone}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to send text to ${phoneNumber}:`);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
    return null;
  }
}

// ==================== Webhook: WATI Incoming Message ====================
app.post('/webhook/wati', async (req, res) => {
  console.log('\n📨 ========== WATI WEBHOOK RECEIVED ==========');
  console.log('Timestamp:', new Date().toISOString());
  
  try {
    const messageData = req.body;
    
    // Extract phone number
    let phoneNumber = messageData.waId || messageData.phoneNumber || messageData.from;
    
    // Extract message text
    let message = messageData.text || messageData.message;
    
    // Handle button clicks
    if (messageData.buttonReply && messageData.buttonReply.text) {
      message = messageData.buttonReply.text;
      console.log(`🔘 Button: ${message}`);
    }
    if (messageData.interactiveButtonReply && messageData.interactiveButtonReply.title) {
      message = messageData.interactiveButtonReply.title;
      console.log(`🔘 Interactive Button: ${message}`);
    }
    
    console.log(`📞 Phone: ${phoneNumber}`);
    console.log(`💬 Message: ${message}`);
    
    if (!phoneNumber) {
      console.log('⚠️ No phone number');
      return res.status(200).send('OK');
    }
    
    // Clean phone number
    phoneNumber = phoneNumber.replace(/^\+91/, '').replace(/[^0-9]/g, '');
    console.log(`📱 Cleaned: ${phoneNumber}`);
    
    // Check for Book Now trigger
    const isBookNow = message && (
      message.toLowerCase() === 'book now' || 
      message.toLowerCase().includes('book now') ||
      message.toLowerCase() === 'book'
    );
    
    if (isBookNow) {
      console.log('🎯 Campaign trigger detected!');
      await handleCampaignLead(phoneNumber);
    } else if (message && message.trim().length > 0) {
      await handlePatientReply(phoneNumber, message);
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('OK');
  }
});

// Handle New Campaign Lead
async function handleCampaignLead(phoneNumber) {
  console.log('\n🎯 ========== NEW CAMPAIGN LEAD ==========');
  console.log(`📱 Phone: ${phoneNumber}`);
  console.log(`⏰ Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  
  // Check existing lead
  const existingLead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (existingLead) {
    console.log(`⚠️ Lead already exists: ${existingLead.status} (${existingLead.executiveAssigned})`);
    return;
  }
  
  // Assign executive
  const executive = getNextExecutive();
  if (!executive) {
    console.log('❌ No executives available');
    return;
  }
  
  console.log(`👤 Assigned: ${executive.name} (${executive.whatsapp})`);
  
  // Save lead
  const lead = new Lead({
    phoneNumber,
    executiveAssigned: executive.name,
    executivePhone: executive.whatsapp,
    status: 'assigned'
  });
  await lead.save();
  console.log(`✅ Lead saved: ${lead._id}`);
  
  // Template names from env (YOUR EXACT NAMES)
  const leadTemplate = process.env.LEAD_TEMPLATE_NAME || 'campaign_women';
  const execTemplate = process.env.EXECUTIVE_TEMPLATE_NAME || 'new_lead_campaign';
  
  // Links
  const mammographyLink = process.env.MAMMOGRAPHY_LINK || 'https://www.nibib.nih.gov/sites/default/files/2022-05/Fact-Sheet-Mammography.pdf';
  const dexaLink = process.env.DEXA_LINK || 'https://www.youtube.com/watch?v=HkLuviUi8Mc';
  const bloodPackageLink = process.env.BLOOD_PACKAGE_LINK || 'https://www.airmedlabs.com/';
  const bookingLink = process.env.BOOKING_LINK || `https://wa.me/${phoneNumber}?text=I%20want%20to%20book`;
  
  // Send to customer
  console.log(`📤 Sending to customer: ${phoneNumber}`);
  console.log(`   Template: ${leadTemplate}`);
  
  await sendWatiTemplate(phoneNumber, leadTemplate, [
    { name: '1', value: mammographyLink },
    { name: '2', value: dexaLink },
    { name: '3', value: bloodPackageLink },
    { name: '4', value: bookingLink }
  ]);
  
  // Send to executive
  console.log(`📤 Sending to executive: ${executive.whatsapp}`);
  console.log(`   Template: ${execTemplate}`);
  
  const callLink = `tel:+91${executive.phone}`;
  const whatsappChatLink = `https://wa.me/${executive.whatsapp}?text=Hi%20${encodeURIComponent(executive.name)}%2C%20New%20lead%20${phoneNumber}`;
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  
  await sendWatiTemplate(executive.whatsapp, execTemplate, [
    { name: '1', value: phoneNumber },
    { name: '2', value: callLink },
    { name: '3', value: whatsappChatLink },
    { name: '4', value: currentTime }
  ]);
  
  console.log(`✅ Lead complete for ${phoneNumber}`);
  executive.leadCount++;
  console.log(`📊 ${executive.name} now has ${executive.leadCount} leads`);
}

// Handle Patient Replies
async function handlePatientReply(phoneNumber, message) {
  console.log(`💬 Reply from ${phoneNumber}: ${message}`);
  
  const lead = await Lead.findOne({ phoneNumber, campaign: 'health_checkup' });
  if (!lead) {
    console.log(`⚠️ No lead for ${phoneNumber}`);
    return;
  }
  
  const msgLower = message.toLowerCase();
  if (msgLower.includes('mammography')) lead.testType = 'Mammography';
  else if (msgLower.includes('dexa')) lead.testType = 'DEXA';
  else if (msgLower.includes('blood')) lead.testType = 'Blood Package';
  else if (message.length > 3 && !lead.testDetails && lead.testType) {
    lead.testDetails = message;
  } else if (message.length > 3 && !lead.name) {
    lead.name = message;
  }
  
  lead.updatedAt = new Date();
  await lead.save();
  
  if (lead.executivePhone) {
    const replyMsg = `📩 *Patient Update*\n\n👤 ${phoneNumber}\n💬 "${message.substring(0, 80)}"\n\n💬 Chat: https://wa.me/${phoneNumber}`;
    await sendWatiText(lead.executivePhone, replyMsg);
  }
}

// ==================== Dashboard API Endpoints ====================
app.get('/api/leads', async (req, res) => {
  try {
    const { status, executive, limit = 100 } = req.query;
    let filter = { campaign: 'health_checkup' };
    if (status && status !== 'all') filter.status = status;
    if (executive && executive !== 'all') filter.executiveAssigned = executive;
    
    const leads = await Lead.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit));
    res.json({ success: true, data: leads });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const totalLeads = await Lead.countDocuments({ campaign: 'health_checkup' });
    const today = new Date(); today.setHours(0,0,0,0);
    const todayLeads = await Lead.countDocuments({ campaign: 'health_checkup', createdAt: { $gte: today } });
    const converted = await Lead.countDocuments({ campaign: 'health_checkup', status: 'converted' });
    const assigned = await Lead.countDocuments({ campaign: 'health_checkup', status: 'assigned' });
    
    const executiveStats = [];
    for (const exec of executives) {
      const execLeads = await Lead.countDocuments({ campaign: 'health_checkup', executiveAssigned: exec.name });
      const execConverted = await Lead.countDocuments({ campaign: 'health_checkup', executiveAssigned: exec.name, status: 'converted' });
      executiveStats.push({
        name: exec.name,
        phone: exec.phone,
        totalLeads: execLeads,
        converted: execConverted,
        conversionRate: execLeads > 0 ? ((execConverted / execLeads) * 100).toFixed(1) : 0
      });
    }
    
    res.json({ success: true, stats: { totalLeads, todayLeads, converted, assigned }, executiveStats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/leads/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const lead = await Lead.findByIdAndUpdate(req.params.id, { status, updatedAt: new Date() }, { new: true });
    res.json({ success: true, data: lead });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 HEALTH CAMPAIGN SERVER STARTED');
  console.log('='.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/wati`);
  console.log('='.repeat(60));
  console.log('📌 Template Names:');
  console.log(`   Lead Template: ${process.env.LEAD_TEMPLATE_NAME || 'campaign_women'}`);
  console.log(`   Executive Template: ${process.env.EXECUTIVE_TEMPLATE_NAME || 'new_lead_campaign'}`);
  console.log('='.repeat(60));
});
