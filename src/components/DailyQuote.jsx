const QUOTES = [
  { text: 'Discipline is doing what needs to be done, even when you don\'t want to do it.', author: 'Unknown' },
  { text: 'The will to win is nothing without the will to prepare.', author: 'Juma Ikangaa' },
  { text: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Robert Collier' },
  { text: 'Champions keep playing until they get it right.', author: 'Billie Jean King' },
  { text: 'Hard work beats talent when talent doesn\'t work hard.', author: 'Tim Notke' },
  { text: 'It\'s not whether you get knocked down; it\'s whether you get up.', author: 'Vince Lombardi' },
  { text: 'The difference between the impossible and the possible lies in determination.', author: 'Tommy Lasorda' },
  { text: 'Focus on the journey, not the destination.', author: 'Greg Anderson' },
  { text: 'Winning isn\'t everything, but wanting to win is.', author: 'Vince Lombardi' },
  { text: 'You miss 100% of the shots you don\'t take.', author: 'Wayne Gretzky' },
  { text: 'The harder the battle, the sweeter the victory.', author: 'Les Brown' },
  { text: 'Concentrate all your thoughts upon the work at hand.', author: 'Alexander Graham Bell' },
  { text: 'Pain is temporary. Quitting lasts forever.', author: 'Lance Armstrong' },
  { text: 'A champion is afraid of losing. Everyone else is afraid of winning.', author: 'Billie Jean King' },
  { text: 'Talent wins games, but teamwork and intelligence win championships.', author: 'Michael Jordan' },
  { text: 'The price of success is hard work, dedication, and the determination not to give up.', author: 'Vince Lombardi' },
  { text: 'Believe you can and you\'re halfway there.', author: 'Theodore Roosevelt' },
  { text: 'The successful warrior is the average man with laser-like focus.', author: 'Bruce Lee' },
  { text: 'You have to expect things of yourself before you can do them.', author: 'Michael Jordan' },
  { text: 'The mind is the athlete; the body is simply the means it uses.', author: 'Bryce Courtenay' },
  { text: 'It\'s not about perfect. It\'s about effort.', author: 'Jillian Michaels' },
  { text: 'Every champion was once a contender who refused to give up.', author: 'Sylvester Stallone' },
  { text: 'Strength does not come from winning. Your struggles develop your strengths.', author: 'Arnold Schwarzenegger' },
  { text: 'The only limit to our realization of tomorrow is our doubts of today.', author: 'Franklin D. Roosevelt' },
  { text: 'Push yourself, because no one else is going to do it for you.', author: 'Unknown' },
  { text: 'Motivation is what gets you started. Habit is what keeps you going.', author: 'Jim Ryun' },
  { text: 'You don\'t have to be great to start, but you have to start to be great.', author: 'Zig Ziglar' },
  { text: 'Do it now. Sometimes later becomes never.', author: 'Unknown' },
  { text: 'Victory is in having done your best.', author: 'Billy Bowerman' },
  { text: 'Success is not final; failure is not fatal: it is the courage to continue that counts.', author: 'Winston Churchill' },
  { text: 'The only place where success comes before work is in the dictionary.', author: 'Vidal Sassoon' },
  { text: 'You can\'t put a limit on anything. The more you dream, the farther you get.', author: 'Michael Phelps' },
  { text: 'Some people want it to happen, some wish it would happen, others make it happen.', author: 'Michael Jordan' },
  { text: 'Don\'t watch the clock; do what it does. Keep going.', author: 'Sam Levenson' },
  { text: 'Act as if what you do makes a difference. It does.', author: 'William James' },
  { text: 'Opportunities don\'t happen. You create them.', author: 'Chris Grosser' },
  { text: 'Do not wait; the time will never be just right.', author: 'Napoleon Hill' },
  { text: 'The man who has confidence in himself gains the confidence of others.', author: 'Hasidic Proverb' },
  { text: 'It ain\'t over till it\'s over.', author: 'Yogi Berra' },
  { text: 'Great things never came from comfort zones.', author: 'Unknown' },
  { text: 'Success usually comes to those who are too busy to be looking for it.', author: 'Henry David Thoreau' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Don\'t limit your challenges. Challenge your limits.', author: 'Unknown' },
  { text: 'Pressure is a privilege — it only comes to those who earn it.', author: 'Billie Jean King' },
  { text: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein' },
]

export default function DailyQuote() {
  const start = new Date(new Date().getFullYear(), 0, 0)
  const dayOfYear = Math.floor((Date.now() - start) / 86_400_000)
  const { text, author } = QUOTES[dayOfYear % QUOTES.length]

  return (
    <div style={{ padding: '9px 16px', borderBottom: '1px solid #222', textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 11, color: '#7a7a7a', fontStyle: 'italic', lineHeight: 1.5 }}>
        "{text}" — {author}
      </p>
    </div>
  )
}
