import { redirect } from 'next/navigation';

/** The ranking home is today's ranking. */
export default function RankingIndex() {
  redirect('/ranking/daily');
}
