-- Indexes for the two foreign keys the performance advisor flagged.
create index spins_prize_position_idx on public.spins (prize_position);
create index vote_rounds_winner_idx on public.vote_rounds (winner_id);
