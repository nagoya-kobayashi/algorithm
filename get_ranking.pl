#!perl
use strict;
use warnings;
use File::Spec;
use FindBin qw($Bin);
use Encode qw(decode);
use JSON::PP qw(encode_json);

my @LOG_COLUMNS = qw(
  received_at year class no user_id name round_no search_count clear_time_ms
);

my $LOG_FILE = File::Spec->catfile($Bin, "search_game_results.tsv");
my $STUDENT_CSV = find_student_csv();

main();

sub main {
  binmode(STDOUT, ":raw");

  my $method = $ENV{REQUEST_METHOD} || "";
  if ($method ne "GET") {
    return_json({ ok => 0, error => "method_not_allowed" });
    return;
  }

  my $params = parse_params($ENV{QUERY_STRING} || "");
  my $user_id = trim($params->{user_id});
  my $round_no = parse_int($params->{round_no});

  if (!valid_user_id($user_id)) {
    return_json({ ok => 0, error => "invalid_user_id" });
    return;
  }
  if (!defined $round_no || $round_no < 1 || $round_no > 4) {
    return_json({ ok => 0, error => "invalid_round_no" });
    return;
  }

  my $user_map = load_user_map($STUDENT_CSV);
  my $user = $user_map->{$user_id};
  if (!$user) {
    return_json({ ok => 0, error => "user_id_not_found" });
    return;
  }

  my $entries = read_log_entries($LOG_FILE);
  my $ranking = build_ranking($entries, $user, $round_no);

  return_json({
    ok => 1,
    ranking => $ranking->{items},
    count => $ranking->{count},
  });
}

sub parse_params {
  my ($raw) = @_;
  my %params;
  for my $pair (split /&/, $raw // "") {
    next if $pair eq "";
    my ($key, $val) = split /=/, $pair, 2;
    $key = url_decode($key // "");
    $val = url_decode($val // "");
    $params{$key} = $val;
  }
  return \%params;
}

sub url_decode {
  my ($value) = @_;
  $value =~ tr/+/ /;
  $value =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg;
  return decode("UTF-8", $value);
}

sub trim {
  my ($value) = @_;
  $value = "" unless defined $value;
  $value =~ s/^\s+//;
  $value =~ s/\s+$//;
  return $value;
}

sub parse_int {
  my ($value) = @_;
  return undef unless defined $value;
  return undef unless $value =~ /\A-?\d+\z/;
  return int($value);
}

sub valid_user_id {
  my ($user_id) = @_;
  return 0 unless defined $user_id;
  return 0 if length($user_id) < 1 || length($user_id) > 32;
  return ($user_id =~ /\A[0-9A-Za-z._-]+\z/);
}

sub read_log_entries {
  my ($path) = @_;
  my @entries;
  return \@entries unless -e $path;

  my $fh;
  if (!open($fh, "<:encoding(UTF-8)", $path)) {
    return \@entries;
  }

  my %index = map { $LOG_COLUMNS[$_] => $_ } 0 .. $#LOG_COLUMNS;

  while (my $line = <$fh>) {
    chomp $line;
    next if $line =~ /^\s*$/;
    my @vals = split /\t/, $line, -1;
    if ($vals[0] && $vals[0] eq "received_at") {
      %index = map { $vals[$_] => $_ } 0 .. $#vals;
      next;
    }

    my %entry;
    for my $key (keys %index) {
      my $idx = $index{$key};
      $entry{$key} = defined $idx ? ($vals[$idx] // "") : "";
    }
    push @entries, \%entry;
  }
  close($fh);
  return \@entries;
}

sub build_ranking {
  my ($entries, $user, $round_no) = @_;
  my $target_year = trim($user->{year});
  my $target_class = trim($user->{class});

  my %best;
  for my $entry (@$entries) {
    next if trim($entry->{year}) ne $target_year;
    next if trim($entry->{class}) ne $target_class;
    my $entry_round = parse_int($entry->{round_no});
    next if !defined $entry_round || $entry_round != $round_no;

    my $user_id = trim($entry->{user_id});
    next unless $user_id;

    my $search_count = parse_int($entry->{search_count});
    my $clear_time_ms = parse_int($entry->{clear_time_ms});
    next if !defined $search_count || !defined $clear_time_ms;

    my $candidate = {
      user_id => $user_id,
      search_count => $search_count,
      clear_time_ms => $clear_time_ms,
      received_at => trim($entry->{received_at}),
      no => trim($entry->{no}),
      name => trim($entry->{name}),
    };

    my $current = $best{$user_id};
    if (!$current || is_better($candidate, $current)) {
      $best{$user_id} = $candidate;
    }
  }

  my @sorted = sort {
    $a->{clear_time_ms} <=> $b->{clear_time_ms}
      || $a->{search_count} <=> $b->{search_count}
      || $a->{received_at} cmp $b->{received_at}
  } values %best;

  my $count = scalar @sorted;
  my @items;
  my $rank = 1;
  for my $item (@sorted) {
    push @items, {
      rank => $rank,
      display_name => format_display_name($item),
      search_count => $item->{search_count},
      clear_time_ms => $item->{clear_time_ms},
      user_id => $item->{user_id},
    };
    $rank++;
  }

  return { items => \@items, count => $count };
}

sub is_better {
  my ($candidate, $current) = @_;
  return 1 if $candidate->{clear_time_ms} < $current->{clear_time_ms};
  return 0 if $candidate->{clear_time_ms} > $current->{clear_time_ms};
  return 1 if $candidate->{search_count} < $current->{search_count};
  return 0 if $candidate->{search_count} > $current->{search_count};
  return ($candidate->{received_at} lt $current->{received_at});
}

sub format_display_name {
  my ($item) = @_;
  my $full_name = trim($item->{name} || "");
  my $no = $item->{no} || "";
  my $display = trim(join(" ", grep { $_ ne "" } ($no, $full_name)));
  return $display ne "" ? $display : $item->{user_id};
}

sub load_user_map {
  my ($path) = @_;
  my %map;
  return \%map unless -e $path;

  my $fh;
  if (!open($fh, "<:encoding(UTF-8)", $path)) {
    return \%map;
  }

  my $header = <$fh>;
  if (!defined $header) {
    close($fh);
    return \%map;
  }

  $header =~ s/^\x{FEFF}//;
  chomp $header;
  my @cols = split /,/, $header;
  my %idx;
  for my $i (0 .. $#cols) {
    $idx{$cols[$i]} = $i;
  }
  for my $required (qw(id year class no name)) {
    if (!exists $idx{$required}) {
      close($fh);
      return \%map;
    }
  }

  while (my $line = <$fh>) {
    chomp $line;
    next if $line =~ /^\s*$/;
    my @vals = split /,/, $line, -1;
    my $id = trim($vals[$idx{id}] // "");
    next if $id eq "";
    $map{$id} = {
      year  => trim($vals[$idx{year}] // ""),
      class => trim($vals[$idx{class}] // ""),
      no    => trim($vals[$idx{no}] // ""),
      name  => trim($vals[$idx{name}] // ""),
    };
  }
  close($fh);
  return \%map;
}

sub find_student_csv {
  my @candidates = (
    File::Spec->catfile($Bin, "student.csv"),
    File::Spec->catfile($Bin, "..", "student.csv"),
  );
  for my $path (@candidates) {
    return $path if -e $path;
  }
  return $candidates[0];
}

sub return_json {
  my ($payload) = @_;
  print "Content-Type: application/json; charset=UTF-8\n\n";
  print encode_json($payload);
}
