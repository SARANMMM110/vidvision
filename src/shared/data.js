'use strict';
// Shared catalogues used by the main process and the UI.

const MODULES = {
  vision: { name: 'Vision Engine', short: 'Vision', desc: 'AI video analyzer — discover, analyze, clip, document and repurpose videos.' },
  voice: { name: 'Voice Engine', short: 'Voice', desc: 'AI voice studio — text to speech, cloning, voice design, studio and audiobooks.' },
  scribe: { name: 'Scribe Engine', short: 'Scribe', desc: 'Transcribe, translate and AI-analyze audio and video in bulk.' },
};

const WHISPER_LANGS = [['auto', 'Auto-detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ru', 'Russian'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['tr', 'Turkish'], ['pl', 'Polish'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'], ['id', 'Indonesian'], ['th', 'Thai'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'], ['el', 'Greek'], ['cs', 'Czech'], ['ro', 'Romanian'], ['hu', 'Hungarian'], ['he', 'Hebrew'], ['fa', 'Persian'], ['bn', 'Bengali'], ['ur', 'Urdu'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'], ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ne', 'Nepali'], ['si', 'Sinhala'], ['ms', 'Malay'], ['tl', 'Tagalog'], ['sw', 'Swahili'], ['af', 'Afrikaans'], ['sq', 'Albanian'], ['am', 'Amharic'], ['hy', 'Armenian'], ['az', 'Azerbaijani'], ['eu', 'Basque'], ['be', 'Belarusian'], ['bs', 'Bosnian'], ['bg', 'Bulgarian'], ['ca', 'Catalan'], ['hr', 'Croatian'], ['et', 'Estonian'], ['gl', 'Galician'], ['ka', 'Georgian'], ['ht', 'Haitian Creole'], ['ha', 'Hausa'], ['is', 'Icelandic'], ['jw', 'Javanese'], ['kk', 'Kazakh'], ['km', 'Khmer'], ['lo', 'Lao'], ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['lb', 'Luxembourgish'], ['mk', 'Macedonian'], ['mg', 'Malagasy'], ['mt', 'Maltese'], ['mi', 'Maori'], ['mn', 'Mongolian'], ['my', 'Myanmar'], ['oc', 'Occitan'], ['ps', 'Pashto'], ['sa', 'Sanskrit'], ['sr', 'Serbian'], ['sn', 'Shona'], ['sd', 'Sindhi'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['so', 'Somali'], ['su', 'Sundanese'], ['tg', 'Tajik'], ['tt', 'Tatar'], ['bo', 'Tibetan'], ['tk', 'Turkmen'], ['uz', 'Uzbek'], ['cy', 'Welsh'], ['yi', 'Yiddish'], ['yo', 'Yoruba'], ['fo', 'Faroese'], ['ln', 'Lingala'], ['br', 'Breton'], ['ba', 'Bashkir'], ['la', 'Latin'], ['haw', 'Hawaiian'], ['yue', 'Cantonese']];

const MARKETS = [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['NZ', 'New Zealand'], ['IE', 'Ireland'], ['IN', 'India'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['PH', 'Philippines'], ['SG', 'Singapore'], ['MY', 'Malaysia'], ['ID', 'Indonesia'], ['TH', 'Thailand'], ['VN', 'Vietnam'], ['JP', 'Japan'], ['KR', 'South Korea'], ['TW', 'Taiwan'], ['HK', 'Hong Kong'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['EG', 'Egypt'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['ZA', 'South Africa'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['PL', 'Poland'], ['TR', 'Turkey'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['CO', 'Colombia']];

const RANKING = [
  ['relevance', 'Relevance', 'YouTube\'s own order'],
  ['standout', 'Standout', 'Views far above the channel\'s size'],
  ['fastest', 'Fastest', 'Most views per day since upload'],
  ['views', 'Most viewed', 'Highest total views'],
  ['likes', 'Most liked', 'Highest total likes'],
  ['discussed', 'Most discussed', 'Most comments'],
  ['engagement', 'Engagement', 'Likes + comments relative to views'],
  ['shared', 'Most shared', 'Shares/reposts where available, else conversation rate'],
  ['rising', 'Rising', 'Fast growth in the last 30 days'],
  ['gems', 'Hidden gems', 'Small channels (<50k) with outsized views'],
  ['newest', 'Newest', 'Most recent uploads first'],
  ['following', 'Biggest following', 'Channels with the most followers first'],
  ['longest', 'Longest', 'Longest videos first'],
  ['channel', 'Channel A–Z', 'Grouped by channel name'],
];

const SEARCH_FILTERS = [['any', 'Any time'], ['hour', 'Last hour'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['cc', 'Creative Commons only'], ['short', 'Under 4 minutes'], ['long', 'Over 20 minutes']];

const LENSES = [
  ['claims', 'Claims & evidence', 'Every claim made and the evidence (or lack of it) offered for it.'],
  ['steps', 'Step-by-step process', 'Every step, instruction or method in order, with the details needed to follow it.'],
  ['offer', 'The offer', 'What is sold: product, price, bonuses, guarantee, urgency, scarcity, CTA and objections handled.'],
  ['hook', 'Hook teardown', 'How the first 30–60 seconds grab attention: pattern interrupts, promises, curiosity loops, visuals.'],
  ['quotes', 'Key quotes', 'The most quotable, shareable lines, verbatim.'],
  ['stats', 'Numbers & statistics', 'Every number, statistic, metric and result mentioned, with its context.'],
  ['stories', 'Stories & examples', 'Stories, case studies, analogies and examples used to make a point.'],
  ['tools', 'Tools & resources', 'Every tool, app, website, book, person or resource named or shown.'],
  ['objections', 'Objections handled', 'Doubts and objections the speaker anticipates, and how each is answered.'],
  ['cta', 'Calls to action', 'Every call to action, where it appears and how it is framed.'],
  ['visual', 'Visual techniques', 'On-screen text, B-roll, graphics, editing and framing choices and why they work.'],
  ['mistakes', 'Mistakes & warnings', 'Mistakes, pitfalls and warnings the viewer is told to avoid.'],
];

const DOC_TYPES = [
  ['guide', 'Step-by-step guide', 'A practical how-to guide with numbered steps, illustrated with screen captures.'],
  ['workbook', 'Workbook', 'A workbook with short lessons, exercises, reflection questions and fill-in blanks after each section.'],
  ['webinar', 'Webinar notes', 'Detailed notes of a webinar/training: agenda, key teaching points, slides captured, Q&A, offer summary.'],
  ['teardown', 'Teardown', 'An analytical teardown of the video: structure, hook, persuasion techniques, offer, what to copy and what to improve.'],
  ['checklist', 'Checklist', 'A concise, actionable checklist grouped by phase.'],
  ['sop', 'SOP', 'A standard operating procedure with purpose, scope, roles, tools and numbered procedure.'],
  ['cheatsheet', 'Cheat sheet', 'A one-to-two page cheat sheet of the essential points, formulas and shortcuts.'],
  ['course', 'Course module', 'A course module: learning objectives, lessons, key takeaways, quiz questions with answers.'],
  ['casestudy', 'Case study', 'A case study: situation, challenge, approach, results, lessons.'],
  ['report', 'Lead magnet report', 'A polished free report suitable as a lead magnet, with a compelling title and clear sections.'],
  ['summary', 'Executive summary', 'A crisp executive summary with key insights, decisions and next steps.'],
  ['faq', 'FAQ', 'A frequently-asked-questions document answering every question the content raises.'],
];

const SOCIAL = [
  ['wordpress', 'Blog post (WordPress)', 0],
  ['linkedin', 'LinkedIn', 3000],
  ['facebook', 'Facebook', 2000],
  ['instagram', 'Instagram', 2200],
  ['x', 'X (Twitter)', 280],
  ['pinterest', 'Pinterest', 500],
];

const IMAGE_LAYOUTS = ['Step-by-step process', 'Timeline', 'Comparison (A vs B)', 'Checklist', 'Statistics grid', 'Mind map', 'Pyramid', 'Funnel', 'Cycle / loop', 'Venn diagram', 'Quote card', 'Before & after', 'Pros & cons', 'Roadmap', '2×2 matrix', 'Flowchart', 'Top 10 list', "Do's & don'ts", 'Myth vs fact', 'Anatomy with callouts', 'Hub & spoke', 'Iceberg', 'Ladder / levels', 'Bar chart', 'Vertical timeline', 'Cheat sheet', 'Recipe / formula card', 'FAQ card', 'Carousel slide', 'Key takeaways'];

const IMAGE_TYPES = [
  ['ig_post', 'Instagram post', '1:1', '1024x1024'],
  ['ig_story', 'Instagram / TikTok story', '9:16', '1024x1536'],
  ['fb_post', 'Facebook post', '4:5', '1024x1536'],
  ['fb_ad', 'Facebook ad', '1:1', '1024x1024'],
  ['li_post', 'LinkedIn post', '4:5', '1024x1536'],
  ['x_post', 'X post', '16:9', '1536x1024'],
  ['pin', 'Pinterest pin', '2:3', '1024x1536'],
  ['yt_thumb', 'YouTube thumbnail', '16:9', '1536x1024'],
  ['blog_header', 'Blog header', '16:9', '1536x1024'],
  ['display_ad', 'Display ad', '1:1', '1024x1024'],
  ['infographic', 'Tall infographic', '2:3', '1024x1536'],
];

const VOICE_STYLES = [
  ['Natural', 'Speak naturally and clearly, like a real person talking to a friend.'],
  ['Warm storyteller', 'Warm, intimate storytelling voice with gentle pacing and vivid emotion.'],
  ['Energetic YouTuber', 'High-energy, upbeat, enthusiastic delivery with punchy emphasis.'],
  ['News anchor', 'Authoritative, neutral broadcast news delivery with crisp diction.'],
  ['Documentary narrator', 'Deep, measured, thoughtful documentary narration.'],
  ['Calm meditation guide', 'Soft, slow, soothing and calm with long relaxed pauses.'],
  ['Bedtime story', 'Gentle, cozy, slightly sleepy bedtime-story voice.'],
  ['Corporate explainer', 'Professional, friendly and confident explainer for a business video.'],
  ['Sales pitch', 'Persuasive, confident and exciting sales delivery that builds urgency.'],
  ['Podcast host', 'Relaxed, conversational podcast host with natural rhythm.'],
  ['Audiobook narrator', 'Expressive audiobook narration, varying tone for dialogue.'],
  ['Teacher', 'Patient, encouraging teacher explaining step by step.'],
  ['Motivational coach', 'Passionate, inspiring motivational speech with rising intensity.'],
  ['Customer support', 'Polite, helpful, reassuring customer-support tone.'],
  ['Movie trailer', 'Epic, dramatic movie-trailer voice with big pauses.'],
  ['Sports commentator', 'Fast, excited sports commentary.'],
  ['Whisper / ASMR', 'Soft whisper, close to the microphone, very gentle.'],
  ['Sarcastic', 'Dry, witty, sarcastic delivery.'],
  ['Cheerful', 'Bright, cheerful and smiling.'],
  ['Serious', 'Serious, grave and sincere.'],
  ['Spooky', 'Mysterious, eerie, suspenseful tone.'],
  ['Pirate', 'Hearty pirate character voice.'],
  ['Robot', 'Flat, mechanical, robotic delivery.'],
  ['Elderly wise', 'Slow, wise, grandparent-like voice.'],
  ['Kids show host', 'Playful, animated, exaggerated kids-TV presenter.'],
  ['Radio DJ', 'Smooth late-night radio DJ.'],
  ['Luxury brand', 'Elegant, refined, slow and luxurious.'],
  ['Local business ad', 'Friendly, trustworthy local radio ad.'],
];

const ACCENTS = ['American', 'British', 'Australian', 'Irish', 'Scottish', 'Indian', 'Canadian', 'South African', 'Nigerian', 'Jamaican'];

const STUDIO_FORMATS = [['podcast', 'Podcast'], ['interview', 'Interview'], ['debate', 'Debate'], ['conversation', 'Conversation'], ['story', 'Story / drama'], ['comedy', 'Comedy sketch'], ['ad', 'Radio ad'], ['explainer', 'Explainer'], ['lesson', 'Lesson / tutorial'], ['news', 'News segment']];

const PROMPT_CATEGORIES = ['Summaries', 'Chapters & structure', 'Podcast & show notes', 'Quotes & highlights', 'Social media', 'SEO & blog', 'Marketing & sales', 'Education & training', 'Analysis & insights', 'Editing & cleanup'];

const P = (cat, id, title, prompt) => ({ id, cat, title, prompt, builtIn: true });
const PROMPTS = [
  P(0, 'sum-short', 'Short summary', 'Write a concise 3–5 sentence summary of this transcript.'),
  P(0, 'sum-bullets', 'Bullet summary', 'Summarize the transcript as 8–12 clear bullet points, most important first.'),
  P(0, 'sum-exec', 'Executive summary', 'Write an executive summary: context, key points, decisions, risks and next steps.'),
  P(0, 'sum-tldr', 'TL;DR', 'Give a one-sentence TL;DR followed by three supporting bullets.'),
  P(0, 'sum-eli5', 'Explain like I\'m 12', 'Explain the content simply, as if to a smart 12-year-old.'),
  P(0, 'sum-takeaways', 'Key takeaways', 'List the 7 most actionable takeaways, each with a one-line explanation.'),
  P(0, 'sum-detailed', 'Detailed summary', 'Write a detailed section-by-section summary with headings.'),
  P(0, 'sum-actions', 'Action items', 'Extract every action item, task or recommendation as a checklist with owner/when if stated.'),
  P(0, 'sum-meeting', 'Meeting minutes', 'Turn this into meeting minutes: attendees (if known), agenda, discussion, decisions, action items.'),
  P(1, 'ch-youtube', 'YouTube chapters', 'Create YouTube chapters with timestamps (format 00:00 Title). First chapter must start at 00:00. Use the timestamps in the transcript.'),
  P(1, 'ch-outline', 'Content outline', 'Create a hierarchical outline (H1/H2/H3) of the content.'),
  P(1, 'ch-topics', 'Topics covered', 'List every topic covered with the timestamp where it starts.'),
  P(1, 'ch-segments', 'Segment breakdown', 'Break the content into logical segments; for each: title, start time, 2-sentence summary.'),
  P(1, 'ch-toc', 'Table of contents', 'Write a table of contents suitable for an ebook version of this content.'),
  P(1, 'ch-mindmap', 'Mind map (text)', 'Produce a text mind map (indented list) of the main ideas and how they connect.'),
  P(1, 'ch-timeline', 'Timeline of events', 'Create a chronological timeline of every event or date mentioned.'),
  P(1, 'ch-speakers', 'Who said what', 'Identify the distinct speakers (by role if names are unknown) and summarize each one\'s main points.'),
  P(2, 'pod-shownotes', 'Show notes', 'Write podcast show notes: hook paragraph, what you\'ll learn bullets, timestamps, resources mentioned, guest bio if any.'),
  P(2, 'pod-titles', 'Episode titles', 'Suggest 10 compelling episode titles (under 70 characters).'),
  P(2, 'pod-desc', 'Episode description', 'Write a 150-word episode description optimized for podcast directories.'),
  P(2, 'pod-guestq', 'Follow-up questions', 'Suggest 10 great follow-up questions for a future interview on this topic.'),
  P(2, 'pod-intro', 'Cold open script', 'Write a 30-second cold-open script teasing the best moment of this episode.'),
  P(2, 'pod-newsletter', 'Newsletter recap', 'Write a newsletter recap of this episode with a strong subject line and 3 key insights.'),
  P(2, 'pod-resources', 'Resources mentioned', 'List every book, tool, website, person and resource mentioned, with context.'),
  P(2, 'pod-trailer', 'Trailer script', 'Write a 60-second trailer script for this episode.'),
  P(3, 'q-pull', 'Pull quotes', 'Extract 10 powerful pull quotes verbatim with timestamps.'),
  P(3, 'q-tweetable', 'Tweetable lines', 'Find 10 lines that would perform well as standalone posts (under 280 characters).'),
  P(3, 'q-clips', 'Clip-worthy moments', 'Identify the 8 best 30–90 second moments for short-form video, with start/end timestamps and a hook title for each.'),
  P(3, 'q-stats', 'Stats & numbers', 'List every statistic and number mentioned with its context and timestamp.'),
  P(3, 'q-stories', 'Stories told', 'Summarize every story or anecdote told and the lesson it illustrates.'),
  P(3, 'q-aha', 'Aha moments', 'List the surprising or counter-intuitive insights in this content.'),
  P(3, 'q-testimonial', 'Testimonial snippets', 'Extract any testimonial-style statements suitable for marketing (verbatim).'),
  P(3, 'q-hooks', 'Hooks', 'Write 10 scroll-stopping hooks based on the strongest ideas in this content.'),
  P(4, 'so-linkedin', 'LinkedIn post', 'Write a LinkedIn post (max 1,300 characters) with a strong first line, short paragraphs and a question at the end.'),
  P(4, 'so-xthread', 'X thread', 'Write an X thread of 8–10 posts, each under 280 characters, numbered.'),
  P(4, 'so-instagram', 'Instagram caption', 'Write an Instagram caption with a hook, value, CTA and 15 relevant hashtags.'),
  P(4, 'so-facebook', 'Facebook post', 'Write an engaging Facebook post that sparks comments.'),
  P(4, 'so-tiktok', 'TikTok script', 'Write a 45-second TikTok script with on-screen text cues.'),
  P(4, 'so-shorts', 'YouTube Shorts ideas', 'Suggest 10 YouTube Shorts ideas from this content with title and 1-line script.'),
  P(4, 'so-carousel', 'Carousel slides', 'Write a 10-slide carousel: slide title + 1–2 lines each.'),
  P(4, 'so-calendar', 'Content calendar', 'Create a 14-day social content calendar repurposing this content across platforms.'),
  P(4, 'so-pinterest', 'Pinterest pins', 'Write 5 Pinterest pin titles and descriptions with keywords.'),
  P(5, 'seo-blog', 'Blog article', 'Turn this into a well-structured SEO blog article (1,200–1,800 words) with H2/H3 headings, intro, conclusion and FAQ.'),
  P(5, 'seo-meta', 'Meta title & description', 'Write 5 SEO meta titles (≤60 chars) and 5 meta descriptions (≤155 chars).'),
  P(5, 'seo-keywords', 'Keywords', 'Extract primary, secondary and long-tail keywords with search intent for each.'),
  P(5, 'seo-faq', 'FAQ schema content', 'Write 8 FAQ question/answer pairs suitable for FAQ schema.'),
  P(5, 'seo-ytdesc', 'YouTube description', 'Write an SEO YouTube description with keywords in the first 2 lines, chapters and 15 tags.'),
  P(5, 'seo-titles', 'YouTube titles', 'Write 10 click-worthy but honest YouTube titles (≤60 characters).'),
  P(5, 'seo-listicle', 'Listicle', 'Turn the content into a "X ways/tips to…" listicle article.'),
  P(5, 'seo-slug', 'Slug & tags', 'Suggest a URL slug, 10 tags and 3 categories.'),
  P(6, 'mk-email', 'Email sequence', 'Write a 3-email nurture sequence based on this content (subject + body each).'),
  P(6, 'mk-salescopy', 'Sales page bullets', 'Write 15 benefit-driven "fascination" bullets for a sales page.'),
  P(6, 'mk-ad', 'Ad copy', 'Write 5 Facebook ad variations: primary text, headline, description.'),
  P(6, 'mk-usp', 'USP & positioning', 'Identify the unique selling proposition, target audience and positioning.'),
  P(6, 'mk-objections', 'Objection handling', 'List likely buyer objections and a persuasive answer to each.'),
  P(6, 'mk-leadmagnet', 'Lead magnet ideas', 'Suggest 7 lead magnet ideas based on this content, with titles.'),
  P(6, 'mk-webinar', 'Webinar outline', 'Create a webinar outline (hook, story, content, offer, close) from this content.'),
  P(6, 'mk-vsl', 'VSL script', 'Write a short video sales letter script inspired by this content.'),
  P(6, 'mk-persona', 'Customer persona', 'Describe the ideal customer persona this content speaks to.'),
  P(7, 'ed-quiz', 'Quiz', 'Write 10 multiple-choice quiz questions with answers and explanations.'),
  P(7, 'ed-flashcards', 'Flashcards', 'Create 20 flashcards (Q → A).'),
  P(7, 'ed-lesson', 'Lesson plan', 'Create a lesson plan: objectives, materials, activities, assessment.'),
  P(7, 'ed-glossary', 'Glossary', 'Create a glossary of key terms with simple definitions.'),
  P(7, 'ed-studyguide', 'Study guide', 'Write a study guide with key concepts, examples and review questions.'),
  P(7, 'ed-worksheet', 'Worksheet', 'Create a worksheet with exercises learners can complete.'),
  P(7, 'ed-howto', 'How-to steps', 'Extract the exact how-to steps someone needs to follow, numbered.'),
  P(7, 'ed-course', 'Course outline', 'Turn this into a mini-course outline with modules and lessons.'),
  P(8, 'an-sentiment', 'Sentiment & tone', 'Analyze the overall sentiment and tone, with examples.'),
  P(8, 'an-swot', 'SWOT analysis', 'Produce a SWOT analysis of the idea, product or business discussed.'),
  P(8, 'an-claims', 'Fact-check list', 'List every factual claim that should be verified before publishing.'),
  P(8, 'an-gaps', 'Content gaps', 'What questions does this content leave unanswered? Suggest follow-up content.'),
  P(8, 'an-competitors', 'Competitor mentions', 'List all competitors, brands or products mentioned and what was said about them.'),
  P(8, 'an-persuasion', 'Persuasion techniques', 'Identify the persuasion and storytelling techniques used, with examples.'),
  P(8, 'an-audience', 'Audience questions', 'What would the audience most likely ask after watching? Answer each.'),
  P(8, 'an-score', 'Content score', 'Score the content 1–10 for clarity, engagement, value and structure, with reasons and improvements.'),
  P(9, 'cl-clean', 'Clean transcript', 'Clean up the transcript: remove filler words, fix punctuation and grammar, keep meaning and wording otherwise.'),
  P(9, 'cl-paragraphs', 'Readable paragraphs', 'Reformat the transcript into readable paragraphs with headings, without changing the words.'),
  P(9, 'cl-speakers', 'Label speakers', 'Rewrite the transcript with speaker labels (Speaker 1, Speaker 2…) inferred from context.'),
  P(9, 'cl-article', 'Rewrite as article', 'Rewrite the transcript as a polished first-person article.'),
  P(9, 'cl-formal', 'Make formal', 'Rewrite in a formal, professional tone.'),
  P(9, 'cl-simple', 'Simplify', 'Rewrite in plain, simple English (grade 6 reading level).'),
  P(9, 'cl-shorten', 'Shorten by half', 'Rewrite to half the length while keeping every key point.'),
  P(9, 'cl-subtitle', 'Subtitle-friendly lines', 'Split into short subtitle-friendly lines (max 42 characters per line).'),
];

module.exports = { MODULES, WHISPER_LANGS, MARKETS, RANKING, SEARCH_FILTERS, LENSES, DOC_TYPES, SOCIAL, IMAGE_LAYOUTS, IMAGE_TYPES, VOICE_STYLES, ACCENTS, STUDIO_FORMATS, PROMPT_CATEGORIES, PROMPTS };
