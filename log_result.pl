#!perl
use strict;
use warnings;
use Fcntl qw(:DEFAULT :flock);
use File::Spec;
use FindBin qw($Bin);
use Time::HiRes qw(time);
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
  if ($method ne "POST") {
    return_json({ ok => 0, error => "method_not_allowed" });
    return;
  }

  my $raw_body = read_body();
  my $params = parse_params($raw_body);

  my $user_id = trim($params->{user_id});
  my $round_no = parse_int($params->{round_no});
  my $search_count = parse_int($params->{search_count});
  my $clear_time_ms = parse_int($params->{clear_time_ms});
  if (!valid_user_id($user_id)) {
    return_json({ ok => 0, error => "invalid_user_id" });
    return;
  }
  if (!defined $round_no || $round_no < 1 || $round_no > 4) {
    return_json({ ok => 0, error => "invalid_round_no" });
    return;
  }
  if (!defined $search_count || $search_count < 1) {
    return_json({ ok => 0, error => "invalid_search_count" });
    return;
  }
  if (!defined $clear_time_ms || $clear_time_ms < 0) {
    return_json({ ok => 0, error => "invalid_clear_time_ms" });
    return;
  }

  my $user_map = load_user_map($STUDENT_CSV);
  my $user = $user_map->{$user_id};
  if (!$user) {
    return_json({ ok => 0, error => "user_id_not_found" });
    return;
  }

  my $received_at = now_local_timestamp();
  my @values = (
    $received_at,
    $user->{year},
    $user->{class},
    $user->{no},
    $user_id,
    $user->{name},
    $round_no,
    $search_count,
    $clear_time_ms,
  );

  if (!append_log_row($LOG_FILE, \@values)) {
    return_json({ ok => 0, error => "server_write_failed" });
    return;
  }

  return_json({ ok => 1 });
}

sub read_body {
  my $len = $ENV{CONTENT_LENGTH} || 0;
  return "" if $len <= 0;
  my $body = "";
  read(STDIN, $body, $len);
  return $body;
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

sub now_local_timestamp {
  my $now = time();
  my $ms = int(($now * 1000) % 1000);
  my @t = localtime($now);
  return sprintf(
    "%04d-%02d-%02d %02d:%02d:%02d.%03d",
    $t[5] + 1900,
    $t[4] + 1,
    $t[3],
    $t[2],
    $t[1],
    $t[0],
    $ms
  );
}

sub append_log_row {
  my ($path, $values) = @_;
  my $need_header = (!-e $path || -s $path == 0);

  my $fh;
  if (!sysopen($fh, $path, O_WRONLY | O_APPEND | O_CREAT)) {
    return 0;
  }
  flock($fh, LOCK_EX);
  binmode($fh, ":encoding(UTF-8)");

  if ($need_header && -s $path == 0) {
    print {$fh} join("\t", @LOG_COLUMNS) . "\n";
  }

  my @safe = map { sanitize_field($_) } @$values;
  print {$fh} join("\t", @safe) . "\n";

  close($fh);
  return 1;
}

sub sanitize_field {
  my ($value) = @_;
  $value = "" unless defined $value;
  $value =~ s/[\r\n\t]/ /g;
  return $value;
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
